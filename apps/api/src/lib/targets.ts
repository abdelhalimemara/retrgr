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
}

/** A partner with no websites configured is unrestricted; otherwise the origin must be listed. */
export function originAllowed(allowed: string[], origin: string | null) {
  if (!allowed.length) return true
  const o = normalizeOrigin(origin)
  return !!o && allowed.some((a) => normalizeOrigin(a) === o)
}

type Row = Target & { allowed_origins: string[] }
const SELECT = `SELECT cp.id AS campaign_id, cp.partner_id, cp.city, p.allowed_origins`

/**
 * Resolves a collector request to an active campaign:
 *  1. the billboard code (bid) — codes are globally unique, so one partner-level
 *     snippet covers all of that partner's campaigns;
 *  2. an explicit campaign slug (hosted page, older snippets);
 *  3. the partner's most recent active campaign.
 * The partner key, when sent, must own the campaign, and the request origin must
 * be one of that partner's websites.
 */
export async function resolveTarget(
  r: { campaign?: string | null; partner?: string | null; bid?: string | null },
  origin: string | null,
): Promise<Target | null> {
  let row: Row | undefined
  if (r.bid) {
    ;[row] = await query<Row>(
      `${SELECT}, pl.id AS placement_id
         FROM placements pl JOIN campaigns cp ON cp.id = pl.campaign_id JOIN partners p ON p.id = cp.partner_id
        WHERE pl.code = $1 AND cp.status = 'active'
          AND ($2::text IS NULL OR p.key = $2) AND ($3::text IS NULL OR cp.slug = $3)`,
      [r.bid, r.partner ?? null, r.campaign ?? null],
    )
  }
  if (!row && r.campaign) {
    ;[row] = await query<Row>(
      `${SELECT}, NULL::uuid AS placement_id
         FROM campaigns cp JOIN partners p ON p.id = cp.partner_id
        WHERE cp.slug = $1 AND cp.status = 'active' AND ($2::text IS NULL OR p.key = $2)`,
      [r.campaign, r.partner ?? null],
    )
  }
  if (!row && r.partner) {
    ;[row] = await query<Row>(
      `${SELECT}, NULL::uuid AS placement_id
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
