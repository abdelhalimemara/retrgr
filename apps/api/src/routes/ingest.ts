import { Hono } from 'hono'
import { query } from '../db.js'
import { writeEvent } from '../lib/events.js'
import { clientUserAgent, isBot, rateLimit, viaSgtm } from '../lib/request.js'
import { engagementSchema, scanSchema } from '../lib/schemas.js'

/**
 * Attribution events from the collector (directly, or via the sGTM Retrgtr Client).
 * Both endpoints require analytics consent in the payload and answer 202 even for
 * unknown campaigns, so they can't be used to enumerate campaigns.
 */
export const ingestRoutes = new Hono()

ingestRoutes.use('/scan', rateLimit({ windowMs: 60_000, max: 30 }))
ingestRoutes.use('/engagement', rateLimit({ windowMs: 60_000, max: 60 }))

ingestRoutes.post('/scan', async (c) => {
  const b = scanSchema.parse(await c.req.json())
  const ua = clientUserAgent(c)
  const bot = isBot(ua)

  const [target] = await query<{ campaign_id: string; placement_id: string | null }>(
    `SELECT cp.id AS campaign_id, pl.id AS placement_id
       FROM campaigns cp LEFT JOIN placements pl ON pl.campaign_id = cp.id AND pl.code = $2
      WHERE cp.slug = $1 AND cp.status = 'active'`,
    [b.campaign, b.bid ?? null],
  )
  if (!target) return c.body(null, 202)

  const ctx = b.context
  const inserted = await query(
    `INSERT INTO scans (id, campaign_id, placement_id, visitor_id, scan_number, offer_variant, device_type, os,
       language, utm_source, utm_medium, utm_campaign, is_bot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
    ],
  )

  if (inserted.length) {
    await writeEvent('scan_events', {
      scan_id: b.scan_id,
      visitor_id: b.visitor_id,
      scan_ts: new Date().toISOString(),
      campaign_id: target.campaign_id,
      placement_id: target.placement_id,
      bid: b.bid ?? null,
      offer_variant: b.offer_variant ?? null,
      scan_number: b.scan_number,
      prior_bids: b.prior_bids,
      is_bot: bot,
      via_sgtm: viaSgtm(c),
      user_agent: ua,
      policy_version: b.consent.policy_version,
      ...ctx,
      ...b.device,
    })
  }
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
  // Engagement only counts for scans we recorded (i.e. analytics consent was given).
  if (updated.length) await writeEvent('engagement_events', { ...b, event_ts: new Date().toISOString() }, `${b.scan_id}:${b.dwell_seconds}`)
  return c.body(null, 202)
})
