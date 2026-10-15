import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AuthEnv } from '../auth.js'
import { audit, query } from '../db.js'
import { campaignSchema, partnerSchema } from '../lib/schemas.js'

/** Partners (OOH media owners / brands) and their campaigns. */
export const catalogRoutes = new Hono<AuthEnv>()

catalogRoutes.get('/partners', async (c) =>
  c.json(
    await query(
      `SELECT p.*, (SELECT count(*)::int FROM campaigns cp WHERE cp.partner_id = p.id) AS campaign_count
         FROM partners p ORDER BY p.name`,
    ),
  ),
)

catalogRoutes.post('/partners', async (c) => {
  const b = partnerSchema.parse(await c.req.json())
  const [row] = await query(
    'INSERT INTO partners (name, contact_email, notes, allowed_origins) VALUES ($1, $2, $3, $4) RETURNING *',
    [b.name, b.contact_email ?? null, b.notes ?? null, b.allowed_origins],
  )
  await audit(c.get('actor'), 'create', 'partner', row.id)
  return c.json(row, 201)
})

catalogRoutes.put('/partners/:id', async (c) => {
  const b = partnerSchema.parse(await c.req.json())
  const [row] = await query(
    'UPDATE partners SET name = $1, contact_email = $2, notes = $3, allowed_origins = $4 WHERE id = $5 RETURNING *',
    [b.name, b.contact_email ?? null, b.notes ?? null, b.allowed_origins, z.uuid().parse(c.req.param('id'))],
  )
  if (!row) throw new HTTPException(404)
  await audit(c.get('actor'), 'update', 'partner', row.id)
  return c.json(row)
})

catalogRoutes.get('/campaigns', async (c) =>
  c.json(
    await query(
      `SELECT cp.*, p.name AS partner_name,
              (SELECT count(DISTINCT t.customer_id)::int FROM touchpoints t WHERE t.campaign_id = cp.id) AS customer_count
         FROM campaigns cp JOIN partners p ON p.id = cp.partner_id
        ORDER BY cp.created_at DESC`,
    ),
  ),
)

const campaignParams = (b: ReturnType<typeof campaignSchema.parse>) => [
  b.partner_id,
  b.name,
  b.slug,
  b.location ?? null,
  b.city ?? null,
  b.starts_on ?? null,
  b.ends_on ?? null,
  b.status,
  b.headline ?? null,
  b.consent_version,
]

catalogRoutes.post('/campaigns', async (c) => {
  const b = campaignSchema.parse(await c.req.json())
  const [row] = await query(
    `INSERT INTO campaigns (partner_id, name, slug, location, city, starts_on, ends_on, status, headline, consent_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    campaignParams(b),
  )
  await audit(c.get('actor'), 'create', 'campaign', row.id)
  return c.json(row, 201)
})

catalogRoutes.put('/campaigns/:id', async (c) => {
  const b = campaignSchema.parse(await c.req.json())
  const [row] = await query(
    `UPDATE campaigns SET partner_id = $1, name = $2, slug = $3, location = $4, city = $5, starts_on = $6,
       ends_on = $7, status = $8, headline = $9, consent_version = $10
     WHERE id = $11 RETURNING *`,
    [...campaignParams(b), c.req.param('id')],
  )
  if (!row) throw new HTTPException(404)
  await audit(c.get('actor'), 'update', 'campaign', row.id)
  return c.json(row)
})
