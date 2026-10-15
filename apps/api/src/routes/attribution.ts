import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { AuthEnv } from '../auth.js'
import { audit, query, withTransaction } from '../db.js'
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
  b.match_param ?? null,
  b.match_value ?? null,
  b.match_path ?? null,
  b.destination_url ?? null,
]

attributionRoutes.post('/placements', async (c) => {
  const b = placementSchema.parse(await c.req.json())
  const [row] = await query(
    `INSERT INTO placements (campaign_id, code, name, format, city, district, latitude, longitude, cost_sar,
       match_param, match_value, match_path, destination_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    placementParams(b),
  )
  await audit(c.get('actor'), 'create', 'placement', row.id)
  return c.json(row, 201)
})

/**
 * Bulk import (CSV upload in the dashboard). All-or-nothing: every row is validated and
 * codes are checked against the file and the database before anything is inserted, and
 * problems are reported per row (1-based, excluding the header).
 */
attributionRoutes.post('/placements/bulk', async (c) => {
  const body = z
    .object({ campaign_id: z.uuid(), rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000) })
    .parse(await c.req.json())
  const errors: { row: number; message: string }[] = []
  const valid: z.infer<typeof placementSchema>[] = []
  const seen = new Map<string, number>()
  body.rows.forEach((raw, i) => {
    const r = placementSchema.safeParse({ ...raw, campaign_id: body.campaign_id })
    if (!r.success) {
      errors.push({ row: i + 1, message: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') })
      return
    }
    if (seen.has(r.data.code)) errors.push({ row: i + 1, message: `code "${r.data.code}" repeats row ${seen.get(r.data.code)}` })
    else seen.set(r.data.code, i + 1)
    valid.push(r.data)
  })
  const taken = await query<{ code: string }>('SELECT code FROM placements WHERE code = ANY($1::text[])', [[...seen.keys()]])
  for (const { code } of taken) errors.push({ row: seen.get(code)!, message: `code "${code}" is already used by another placement` })
  if (errors.length) return c.json({ error: 'Import failed', errors: errors.sort((a, b) => a.row - b.row) }, 400)

  const rows = await withTransaction(async (db) => {
    const out = []
    for (const b of valid) {
      const { rows: [row] } = await db.query(
        `INSERT INTO placements (campaign_id, code, name, format, city, district, latitude, longitude, cost_sar,
           match_param, match_value, match_path, destination_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        placementParams(b),
      )
      out.push(row)
    }
    return out
  })
  await audit(c.get('actor'), 'import', 'placement', body.campaign_id, { count: rows.length })
  return c.json({ imported: rows.length, rows }, 201)
})

attributionRoutes.put('/placements/:id', async (c) => {
  const b = placementSchema.parse(await c.req.json())
  const [row] = await query(
    `UPDATE placements SET campaign_id = $1, code = $2, name = $3, format = $4, city = $5, district = $6,
       latitude = $7, longitude = $8, cost_sar = $9, match_param = $10, match_value = $11, match_path = $12,
       destination_url = $13
     WHERE id = $14 RETURNING *`,
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
  // multi: a lead counts at every billboard they scanned (shared credit).
  // first / last: one billboard per lead, so per-billboard leads add up to the total.
  model: z.enum(['multi', 'first', 'last']).default('multi'),
})

/**
 * Placement scorecard. Bot scans are excluded everywhere. Times are bucketed in
 * Asia/Riyadh so daypart reads match how the billboards are scheduled.
 */
attributionRoutes.get('/attribution', async (c) => {
  const q = rangeQuery.parse(c.req.query())
  const params = [q.campaign_id ?? null, q.from ?? null, q.to ?? null]
  const modelParams = [...params, q.model]
  const scope = `NOT s.is_bot
    AND ($1::uuid IS NULL OR s.campaign_id = $1)
    AND ($2::date IS NULL OR s.created_at >= $2::date)
    AND ($3::date IS NULL OR s.created_at < $3::date + 1)`

  const [placements, hourly, totals] = await Promise.all([
    query(
      // credited: one billboard per lead for first/last touch. "Last" only looks at scans up to
      // the person's sign-up in that campaign, so scans after converting don't steal the credit.
      `WITH credited AS (
         SELECT DISTINCT ON (s.customer_id) s.customer_id, s.placement_id
           FROM scans s
          WHERE ${scope} AND s.customer_id IS NOT NULL AND s.placement_id IS NOT NULL
            AND ($4 = 'first' OR s.created_at <= COALESCE(
                  (SELECT min(t.created_at) FROM touchpoints t WHERE t.customer_id = s.customer_id AND t.campaign_id = s.campaign_id)
                  + interval '1 minute', 'infinity'))
          ORDER BY s.customer_id,
                   CASE WHEN $4 = 'first' THEN extract(epoch FROM s.created_at) ELSE -extract(epoch FROM s.created_at) END
       )
       SELECT pl.id, pl.code, pl.name, pl.city, pl.district, pl.format, pl.cost_sar, cp.name AS campaign_name,
              count(s.id)::int AS scans,
              count(DISTINCT s.visitor_id)::int AS unique_scanners,
              count(s.id) FILTER (WHERE s.scan_number > 1)::int AS repeat_scans,
              -- Redirect-link opens: everyone who scanned, before any consent banner.
              (SELECT coalesce(sum(o.opens), 0)::int FROM qr_opens o
                WHERE o.placement_id = pl.id AND ($2::date IS NULL OR o.day >= $2::date) AND ($3::date IS NULL OR o.day <= $3::date)) AS qr_opens,
              CASE WHEN $4 = 'multi' THEN count(DISTINCT s.customer_id)::int
                   ELSE (SELECT count(*)::int FROM credited cr WHERE cr.placement_id = pl.id) END AS leads,
              round(avg(s.dwell_seconds))::int AS avg_dwell_seconds,
              round(100.0 * count(s.id) FILTER (WHERE s.device_type = 'mobile') / NULLIF(count(s.id), 0))::int AS mobile_pct
         FROM placements pl
         JOIN campaigns cp ON cp.id = pl.campaign_id
         LEFT JOIN scans s ON s.placement_id = pl.id AND ${scope}
        WHERE ($1::uuid IS NULL OR pl.campaign_id = $1)
        GROUP BY pl.id, cp.name
        ORDER BY scans DESC`,
      modelParams,
    ),
    query(
      `SELECT extract(hour FROM s.created_at AT TIME ZONE 'Asia/Riyadh')::int AS hour, count(*)::int AS scans
         FROM scans s WHERE ${scope} GROUP BY 1 ORDER BY 1`,
      params,
    ),
    query(
      `SELECT count(*)::int AS scans, count(DISTINCT s.visitor_id)::int AS unique_scanners,
              count(DISTINCT s.customer_id)::int AS leads,
              count(*) FILTER (WHERE s.placement_id IS NULL)::int AS unattributed_scans,
              (SELECT coalesce(sum(o.opens), 0)::int FROM qr_opens o JOIN placements pl ON pl.id = o.placement_id
                WHERE ($1::uuid IS NULL OR pl.campaign_id = $1) AND ($2::date IS NULL OR o.day >= $2::date)
                  AND ($3::date IS NULL OR o.day <= $3::date)) AS qr_opens
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

  return c.json({ model: q.model, totals: totals[0], placements: withCosts, hourly: hours })
})
