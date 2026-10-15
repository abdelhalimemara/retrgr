import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { AuthEnv } from '../auth.js'
import { audit, query } from '../db.js'
import { placementSchema } from '../lib/schemas.js'

/** Billboard placements and per-placement attribution (scans → leads → cost). */
export const attributionRoutes = new Hono<AuthEnv>()

attributionRoutes.get('/placements', async (c) => {
  const campaignId = z.uuid().optional().parse(c.req.query('campaign_id'))
  return c.json(
    await query(
      `SELECT pl.*, cp.slug AS campaign_slug, cp.name AS campaign_name
         FROM placements pl JOIN campaigns cp ON cp.id = pl.campaign_id
        WHERE ($1::uuid IS NULL OR pl.campaign_id = $1)
        ORDER BY cp.name, pl.name`,
      [campaignId ?? null],
    ),
  )
})

const placementParams = (b: z.infer<typeof placementSchema>) => [
  b.campaign_id,
  b.code,
  b.name,
  b.format ?? null,
  b.city ?? null,
  b.district ?? null,
  b.latitude ?? null,
  b.longitude ?? null,
  b.cost_sar ?? null,
]

attributionRoutes.post('/placements', async (c) => {
  const b = placementSchema.parse(await c.req.json())
  const [row] = await query(
    `INSERT INTO placements (campaign_id, code, name, format, city, district, latitude, longitude, cost_sar)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    placementParams(b),
  )
  await audit(c.get('actor'), 'create', 'placement', row.id)
  return c.json(row, 201)
})

attributionRoutes.put('/placements/:id', async (c) => {
  const b = placementSchema.parse(await c.req.json())
  const [row] = await query(
    `UPDATE placements SET campaign_id = $1, code = $2, name = $3, format = $4, city = $5, district = $6,
       latitude = $7, longitude = $8, cost_sar = $9
     WHERE id = $10 RETURNING *`,
    [...placementParams(b), z.uuid().parse(c.req.param('id'))],
  )
  if (!row) throw new HTTPException(404)
  return c.json(row)
})

attributionRoutes.delete('/placements/:id', async (c) => {
  await query('DELETE FROM placements WHERE id = $1', [z.uuid().parse(c.req.param('id'))])
  return c.body(null, 204)
})

const rangeQuery = z.object({
  campaign_id: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
})

/**
 * Placement scorecard. Bot scans are excluded everywhere. Times are bucketed in
 * Asia/Riyadh so daypart reads match how the billboards are scheduled.
 */
attributionRoutes.get('/attribution', async (c) => {
  const q = rangeQuery.parse(c.req.query())
  const params = [q.campaign_id ?? null, q.from ?? null, q.to ?? null]
  const scope = `NOT s.is_bot
    AND ($1::uuid IS NULL OR s.campaign_id = $1)
    AND ($2::date IS NULL OR s.created_at >= $2::date)
    AND ($3::date IS NULL OR s.created_at < $3::date + 1)`

  const [placements, hourly, totals] = await Promise.all([
    query(
      `SELECT pl.id, pl.code, pl.name, pl.city, pl.district, pl.format, pl.cost_sar, cp.name AS campaign_name,
              count(s.id)::int AS scans,
              count(DISTINCT s.visitor_id)::int AS unique_scanners,
              count(s.id) FILTER (WHERE s.scan_number > 1)::int AS repeat_scans,
              count(DISTINCT s.customer_id)::int AS leads,
              round(avg(s.dwell_seconds))::int AS avg_dwell_seconds,
              round(100.0 * count(s.id) FILTER (WHERE s.device_type = 'mobile') / NULLIF(count(s.id), 0))::int AS mobile_pct
         FROM placements pl
         JOIN campaigns cp ON cp.id = pl.campaign_id
         LEFT JOIN scans s ON s.placement_id = pl.id AND ${scope}
        WHERE ($1::uuid IS NULL OR pl.campaign_id = $1)
        GROUP BY pl.id, cp.name
        ORDER BY scans DESC`,
      params,
    ),
    query(
      `SELECT extract(hour FROM s.created_at AT TIME ZONE 'Asia/Riyadh')::int AS hour, count(*)::int AS scans
         FROM scans s WHERE ${scope} GROUP BY 1 ORDER BY 1`,
      params,
    ),
    query(
      `SELECT count(*)::int AS scans, count(DISTINCT s.visitor_id)::int AS unique_scanners,
              count(DISTINCT s.customer_id)::int AS leads,
              count(*) FILTER (WHERE s.placement_id IS NULL)::int AS unattributed_scans
         FROM scans s WHERE ${scope}`,
      params,
    ),
  ])

  const withCosts = placements.map((p) => {
    const cost = p.cost_sar == null ? null : Number(p.cost_sar)
    return {
      ...p,
      cost_sar: cost,
      cost_per_scan: cost != null && p.scans ? +(cost / p.scans).toFixed(2) : null,
      cost_per_lead: cost != null && p.leads ? +(cost / p.leads).toFixed(2) : null,
      scan_to_lead_pct: p.scans ? +((100 * p.leads) / p.unique_scanners).toFixed(1) : null,
    }
  })
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, scans: hourly.find((r) => r.hour === h)?.scans ?? 0 }))

  return c.json({ totals: totals[0], placements: withCosts, hourly: hours })
})
