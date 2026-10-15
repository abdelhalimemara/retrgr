import { Hono } from 'hono'
import { query } from '../db.js'
import { writeEvents, writeEvent } from '../lib/events.js'
import { clientUserAgent, isBot, rateLimit, requestOrigin, viaSgtm } from '../lib/request.js'
import { resolveTarget } from '../lib/targets.js'
import { dataLayerSchema, engagementSchema, scanSchema } from '../lib/schemas.js'
import { scrubDataLayer } from '../lib/scrub.js'

/**
 * Attribution events from the collector (directly, or via the sGTM Retrgtr Client).
 * Both endpoints require analytics consent in the payload and answer 202 even for
 * unknown campaigns, so they can't be used to enumerate campaigns.
 */
export const ingestRoutes = new Hono()

ingestRoutes.use('/scan', rateLimit({ windowMs: 60_000, max: 30 }))
ingestRoutes.use('/engagement', rateLimit({ windowMs: 60_000, max: 60 }))
ingestRoutes.use('/datalayer', rateLimit({ windowMs: 60_000, max: 60 }))

ingestRoutes.post('/scan', async (c) => {
  const b = scanSchema.parse(await c.req.json())
  const ua = clientUserAgent(c)
  const bot = isBot(ua)

  // Unknown campaign / partner, or a website the partner hasn't registered: accept silently.
  const target = await resolveTarget(b, requestOrigin(c))
  if (!target) return c.body(null, 202)
  // Running without a banner is only allowed for partners set up that way in the dashboard.
  if (b.consent.basis === 'notice' && target.analytics_basis !== 'notice') return c.body(null, 202)

  const ctx = b.context
  const inserted = await query(
    `INSERT INTO scans (id, campaign_id, placement_id, visitor_id, scan_number, offer_variant, device_type, os,
       language, utm_source, utm_medium, utm_campaign, is_bot, analytics_basis)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [
      b.scan_id,
      target.campaign_id,
      target.placement_id,
      b.visitor_id,
      b.scan_number,
      b.offer_variant ?? null,
      ctx.device_type ?? null,
      b.device.os ?? null,
      ctx.language ?? null,
      ctx.utm_source ?? null,
      ctx.utm_medium ?? null,
      ctx.utm_campaign ?? null,
      bot,
      b.consent.basis,
    ],
  )

  if (inserted.length) {
    await writeEvent('scan_events', {
      scan_id: b.scan_id,
      visitor_id: b.visitor_id,
      scan_ts: new Date().toISOString(),
      campaign_id: target.campaign_id,
      placement_id: target.placement_id,
      bid: b.bid ?? target.placement_code,
      offer_variant: b.offer_variant ?? null,
      scan_number: b.scan_number,
      prior_bids: b.prior_bids,
      is_bot: bot,
      via_sgtm: viaSgtm(c),
      user_agent: ua,
      policy_version: b.consent.policy_version,
      analytics_basis: b.consent.basis,
      ...ctx,
      ...b.device,
    })
  }
  // Matched by a client-QR rule: tell the collector the billboard code for the rest of the session.
  if (!b.bid && target.placement_code) return c.json({ bid: target.placement_code }, 202)
  return c.body(null, 202)
})

/** Sent with navigator.sendBeacon on pagehide, so it may arrive as text/plain. */
ingestRoutes.post('/engagement', async (c) => {
  const b = engagementSchema.parse(JSON.parse(await c.req.text()))
  const updated = await query(
    `UPDATE scans SET dwell_seconds = GREATEST(coalesce(dwell_seconds, 0), $2), max_scroll_pct = GREATEST(coalesce(max_scroll_pct, 0), $3),
            cta_clicks = GREATEST(coalesce(cta_clicks, 0), $4)
      WHERE id = $1 RETURNING id`,
    [b.scan_id, b.dwell_seconds, b.max_scroll_pct, b.cta_clicks],
  )
  // Engagement only counts for scans we recorded (i.e. analytics was permitted).
  if (!updated.length) return c.body(null, 202)
  for (const f of b.forms) {
    // Beacons repeat as the visitor comes and goes: keep the furthest progress seen.
    await query(
      `INSERT INTO form_sessions (scan_id, form_id, fields_total, fields_filled, last_field, submitted)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (scan_id, form_id) DO UPDATE SET
         fields_total = GREATEST(form_sessions.fields_total, EXCLUDED.fields_total),
         fields_filled = ARRAY(SELECT DISTINCT unnest(form_sessions.fields_filled || EXCLUDED.fields_filled)),
         last_field = COALESCE(EXCLUDED.last_field, form_sessions.last_field),
         submitted = form_sessions.submitted OR EXCLUDED.submitted,
         updated_at = now()`,
      [b.scan_id, f.form_id, f.fields_total, f.fields_filled, f.last_field ?? null, f.submitted],
    )
  }
  const { forms, ...rest } = b
  await writeEvent(
    'engagement_events',
    { ...rest, forms: forms.length ? JSON.stringify(forms) : null, event_ts: new Date().toISOString() },
    `${b.scan_id}:${b.dwell_seconds}`,
  )
  return c.body(null, 202)
})

/**
 * dataLayer pushes from the landing page (beacon-friendly). Only accepted for scans
 * we recorded, and scrubbed of personal data before they reach BigQuery.
 */
ingestRoutes.post('/datalayer', async (c) => {
  const b = dataLayerSchema.parse(JSON.parse(await c.req.text()))
  const [scan] = await query<{ campaign_id: string | null; placement_id: string | null }>(
    'SELECT campaign_id, placement_id FROM scans WHERE id = $1 AND visitor_id = $2',
    [b.scan_id, b.visitor_id],
  )
  if (!scan) return c.body(null, 202)
  const now = Date.now()
  await writeEvents(
    'datalayer_events',
    b.events.map((e) => ({
      insertId: `${b.scan_id}:${e.seq}`,
      row: {
        scan_id: b.scan_id,
        visitor_id: b.visitor_id,
        campaign_id: scan.campaign_id,
        placement_id: scan.placement_id,
        seq: e.seq,
        // Client clocks drift; keep the client time only when it is plausible.
        event_ts: new Date(Math.abs(now - e.ts) < 86_400_000 ? e.ts : now).toISOString(),
        event_name: e.event ?? null,
        data: JSON.stringify(scrubDataLayer(e.data)).slice(0, 20_000),
      },
    })),
  )
  return c.body(null, 202)
})
