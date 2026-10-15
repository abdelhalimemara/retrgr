import { config } from '../config.js'
import { query } from '../db.js'
import { normalizeOrigin } from './normalize.js'

export { normalizeOrigin }

/** Where a collector request belongs: resolved campaign (+ billboard when the bid matches). */
export interface Target {
  campaign_id: string
  partner_id: string
  city: string | null
  placement_id: string | null
  /** Billboard code, so the collector can carry it on later requests in the session. */
  placement_code: string | null
  /** The partner's legal-basis settings (see migration 007). */
  analytics_basis: 'consent' | 'notice'
  marketing_basis: 'checkbox' | 'form_notice'
  marketing_notice: string | null
  notice_covers_ads: boolean
}

/** A partner with no websites configured is unrestricted; otherwise the origin must be listed. */
export function originAllowed(allowed: string[], origin: string | null) {
  if (!allowed.length) return true
  const o = normalizeOrigin(origin)
  return !!o && allowed.some((a) => normalizeOrigin(a) === o)
}

type Row = Target & { allowed_origins: string[] }
const SELECT = `SELECT cp.id AS campaign_id, cp.partner_id, cp.city, p.allowed_origins,
  p.analytics_basis, p.marketing_basis, p.marketing_notice, p.notice_covers_ads`
const NO_PLACEMENT = `NULL::uuid AS placement_id, NULL::text AS placement_code`

/**
 * Resolves a collector request to an active campaign:
 *  1. the billboard code (bid) — codes are globally unique, so one partner-level
 *     snippet covers all of that partner's campaigns;
 *  2. the partner's matching rules for client-owned QR URLs (query parameter or path prefix);
 *  3. the scan the request belongs to (a lead inherits its scan's billboard);
 *  4. an explicit campaign slug (hosted page, older snippets);
 *  5. the partner's most recent active campaign.
 * The partner key, when sent, must own the campaign, and the request origin must
 * be one of that partner's websites.
 */
export async function resolveTarget(
  r: {
    campaign?: string | null
    partner?: string | null
    bid?: string | null
    scan_id?: string | null
    page?: { path?: string | null; query?: Record<string, string> | null } | null
  },
  origin: string | null,
): Promise<Target | null> {
  let row: Row | undefined
  if (r.bid) {
    ;[row] = await query<Row>(
      `${SELECT}, pl.id AS placement_id, pl.code AS placement_code
         FROM placements pl JOIN campaigns cp ON cp.id = pl.campaign_id JOIN partners p ON p.id = cp.partner_id
        WHERE pl.code = $1 AND cp.status = 'active'
          AND ($2::text IS NULL OR p.key = $2) AND ($3::text IS NULL OR cp.slug = $3)`,
      [r.bid, r.partner ?? null, r.campaign ?? null],
    )
  }
  // Rules are scoped to the partner/campaign, so a common value like utm_content=billboard
  // on one client's site can never match another client's placement.
  if (!row && r.page && (r.partner || r.campaign)) {
    ;[row] = await query<Row>(
      `${SELECT}, pl.id AS placement_id, pl.code AS placement_code
         FROM placements pl JOIN campaigns cp ON cp.id = pl.campaign_id JOIN partners p ON p.id = cp.partner_id
        WHERE cp.status = 'active' AND ($1::text IS NULL OR p.key = $1) AND ($2::text IS NULL OR cp.slug = $2)
          AND ((pl.match_param IS NOT NULL AND lower($3::jsonb ->> pl.match_param) = lower(pl.match_value))
            OR (pl.match_path IS NOT NULL AND starts_with(lower($4::text), lower(pl.match_path))))
        ORDER BY (pl.match_param IS NOT NULL) DESC, length(pl.match_path) DESC NULLS LAST
        LIMIT 1`,
      [r.partner ?? null, r.campaign ?? null, JSON.stringify(r.page.query ?? {}), r.page.path ?? ''],
    )
  }
  if (!row && r.scan_id) {
    ;[row] = await query<Row>(
      `${SELECT}, s.placement_id, pl.code AS placement_code
         FROM scans s JOIN campaigns cp ON cp.id = s.campaign_id JOIN partners p ON p.id = cp.partner_id
         LEFT JOIN placements pl ON pl.id = s.placement_id
        WHERE s.id = $1 AND cp.status = 'active' AND ($2::text IS NULL OR p.key = $2) AND ($3::text IS NULL OR cp.slug = $3)`,
      [r.scan_id, r.partner ?? null, r.campaign ?? null],
    )
  }
  if (!row && r.campaign) {
    ;[row] = await query<Row>(
      `${SELECT}, ${NO_PLACEMENT}
         FROM campaigns cp JOIN partners p ON p.id = cp.partner_id
        WHERE cp.slug = $1 AND cp.status = 'active' AND ($2::text IS NULL OR p.key = $2)`,
      [r.campaign, r.partner ?? null],
    )
  }
  if (!row && r.partner) {
    ;[row] = await query<Row>(
      `${SELECT}, ${NO_PLACEMENT}
         FROM campaigns cp JOIN partners p ON p.id = cp.partner_id
        WHERE p.key = $1 AND cp.status = 'active'
        ORDER BY cp.starts_on DESC NULLS LAST, cp.created_at DESC LIMIT 1`,
      [r.partner],
    )
  }
  if (!row) return null
  // Our own hosted consent page (same origin as the dashboard) is always allowed.
  const hosted = config.adminOrigins.some((a) => normalizeOrigin(a) === normalizeOrigin(origin))
  if (!hosted && !originAllowed(row.allowed_origins, origin)) return null
  const { allowed_origins: _, ...target } = row
  return target
}
