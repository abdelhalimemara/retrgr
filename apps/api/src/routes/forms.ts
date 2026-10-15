import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthEnv } from '../auth.js'
import { query } from '../db.js'

/**
 * Form abandonment analytics, per form and campaign: starts, submits, how far people get
 * (share of starters who filled each field) and where they stop. Field names only.
 */
export const formRoutes = new Hono<AuthEnv>()

const rangeQuery = z.object({
  campaign_id: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
})

formRoutes.get('/forms', async (c) => {
  const q = rangeQuery.parse(c.req.query())
  const params = [q.campaign_id ?? null, q.from ?? null, q.to ?? null]
  const scoped = `WITH f AS (
      SELECT fs.*, s.campaign_id FROM form_sessions fs JOIN scans s ON s.id = fs.scan_id
       WHERE NOT s.is_bot
         AND ($1::uuid IS NULL OR s.campaign_id = $1)
         AND ($2::date IS NULL OR s.created_at >= $2::date)
         AND ($3::date IS NULL OR s.created_at < $3::date + 1))`

  const [forms, fields, dropoffs] = await Promise.all([
    query<{ form_id: string; campaign_id: string; campaign_name: string; starts: number; submits: number; fields_total: number }>(
      `${scoped}
       SELECT f.form_id, f.campaign_id, cp.name AS campaign_name, count(*)::int AS starts,
              count(*) FILTER (WHERE f.submitted)::int AS submits, max(f.fields_total)::int AS fields_total
         FROM f JOIN campaigns cp ON cp.id = f.campaign_id
        GROUP BY f.form_id, f.campaign_id, cp.name ORDER BY starts DESC LIMIT 50`,
      params,
    ),
    query<{ form_id: string; campaign_id: string; field: string; filled: number }>(
      `${scoped}
       SELECT form_id, campaign_id, field, count(*)::int AS filled
         FROM f, unnest(f.fields_filled) AS field GROUP BY 1, 2, 3`,
      params,
    ),
    query<{ form_id: string; campaign_id: string; last_field: string; abandons: number }>(
      `${scoped}
       SELECT form_id, campaign_id, last_field, count(*)::int AS abandons
         FROM f WHERE NOT f.submitted AND f.last_field IS NOT NULL GROUP BY 1, 2, 3`,
      params,
    ),
  ])

  const key = (r: { form_id: string; campaign_id: string }) => `${r.campaign_id}|${r.form_id}`
  return c.json(
    forms.map((f) => {
      const k = key(f)
      const pct = (n: number) => (f.starts ? Math.round((100 * n) / f.starts) : 0)
      return {
        ...f,
        abandons: f.starts - f.submits,
        completion_pct: pct(f.submits),
        // Funnel: fields ordered by how many starters filled them.
        fields: fields
          .filter((r) => key(r) === k)
          .sort((a, b) => b.filled - a.filled)
          .map((r) => ({ field: r.field, filled: r.filled, pct: pct(r.filled) })),
        // Where abandoners were when they left.
        dropoffs: dropoffs
          .filter((r) => key(r) === k)
          .sort((a, b) => b.abandons - a.abandons)
          .slice(0, 5)
          .map((r) => ({ field: r.last_field, abandons: r.abandons })),
      }
    }),
  )
})
