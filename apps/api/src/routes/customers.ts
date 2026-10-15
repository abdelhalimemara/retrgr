import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { AuthEnv } from '../auth.js'
import { audit, query, withTransaction } from '../db.js'
import { flushEventErasures, queueEventErasure } from '../lib/events.js'

export const customerRoutes = new Hono<AuthEnv>()

const listQuery = z.object({
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

customerRoutes.get('/customers', async (c) => {
  const { q, page, pageSize } = listQuery.parse(c.req.query())
  const params: unknown[] = []
  let where = 'TRUE'
  if (q) {
    params.push(`%${q.replace(/[%_\\]/g, '\\$&')}%`)
    where = `(c.email ILIKE $1 OR c.phone ILIKE $1 OR c.first_name ILIKE $1 OR c.last_name ILIKE $1 OR c.city ILIKE $1)`
  }

  const [{ total }] = await query<{ total: number }>(`SELECT count(*)::int AS total FROM customers c WHERE ${where}`, params)
  const rows = await query(
    `SELECT c.id, c.email, c.phone, c.first_name, c.last_name, c.age_range, c.gender, c.city, c.country,
            c.first_seen_at, c.last_seen_at,
            EXISTS (SELECT 1 FROM consents k WHERE k.customer_id = c.id AND k.withdrawn_at IS NULL) AS consent_active,
            (SELECT count(*)::int FROM touchpoints t WHERE t.customer_id = c.id) AS touchpoint_count,
            (SELECT count(*)::int FROM scans s WHERE s.customer_id = c.id AND NOT s.is_bot) AS scan_count
       FROM customers c WHERE ${where}
      ORDER BY c.last_seen_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params,
  )
  return c.json({ rows, total, page, pageSize })
})

customerRoutes.get('/customers/:id', async (c) => {
  const id = z.uuid().parse(c.req.param('id'))
  const [customer] = await query('SELECT * FROM customers WHERE id = $1', [id])
  if (!customer) throw new HTTPException(404)

  const [consents, touchpoints] = await Promise.all([
    query(
      `SELECT k.id, k.policy_version, k.purposes, k.granted_at, k.withdrawn_at, cp.name AS campaign_name
         FROM consents k LEFT JOIN campaigns cp ON cp.id = k.campaign_id
        WHERE k.customer_id = $1 ORDER BY k.granted_at DESC`,
      [id],
    ),
    query(
      `SELECT t.*, cp.name AS campaign_name, pl.name AS placement_name
         FROM touchpoints t LEFT JOIN campaigns cp ON cp.id = t.campaign_id
         LEFT JOIN placements pl ON pl.id = t.placement_id
        WHERE t.customer_id = $1 ORDER BY t.created_at DESC`,
      [id],
    ),
  ])
  await audit(c.get('actor'), 'view', 'customer', id)
  return c.json({ customer, consents, touchpoints })
})

/** Hard delete — PDPL right to destruction. Cascades to consents, touchpoints and scans. */
customerRoutes.delete('/customers/:id', async (c) => {
  const id = z.uuid().parse(c.req.param('id'))
  const scanIds = await withTransaction(async (client) => {
    const { rows: scans } = await client.query<{ id: string }>('SELECT id FROM scans WHERE customer_id = $1', [id])
    const { rowCount } = await client.query('DELETE FROM customers WHERE id = $1', [id])
    if (!rowCount) throw new HTTPException(404)
    // BigQuery events are pseudonymous, but erase them too so nothing about the person remains.
    // Queued in the same transaction so the erasure survives streaming-buffer refusals.
    const ids = scans.map((s) => s.id)
    await queueEventErasure(client, ids)
    return ids
  })
  const { pending } = await flushEventErasures(scanIds)
  await audit(c.get('actor'), 'erase', 'customer', id, { scans: scanIds.length, bigquery_pending: pending })
  return c.body(null, 204)
})

customerRoutes.get('/stats', async (c) => {
  const [totals] = await query(
    `SELECT
       (SELECT count(*)::int FROM customers) AS customers,
       (SELECT count(DISTINCT customer_id)::int FROM consents WHERE withdrawn_at IS NULL AND 'marketing' = ANY(purposes)) AS consented,
       (SELECT count(*)::int FROM campaigns WHERE status = 'active') AS active_campaigns,
       (SELECT count(*)::int FROM exports) AS exports`,
  )
  const daily = await query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS date, count(t.id)::int AS captures
       FROM generate_series(current_date - 29, current_date, '1 day') d
       LEFT JOIN touchpoints t ON t.created_at::date = d
      GROUP BY d ORDER BY d`,
  )
  const byCampaign = await query(
    `SELECT cp.name, count(t.id)::int AS captures
       FROM campaigns cp LEFT JOIN touchpoints t ON t.campaign_id = cp.id
      GROUP BY cp.id ORDER BY captures DESC LIMIT 6`,
  )
  const demographics = await query(
    `SELECT coalesce(age_range, 'unknown') AS age_range, coalesce(gender, 'undisclosed') AS gender, count(*)::int AS count
       FROM customers GROUP BY 1, 2`,
  )
  return c.json({ totals, daily, byCampaign, demographics })
})
