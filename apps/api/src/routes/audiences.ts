import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { AuthEnv } from '../auth.js'
import { audit, query } from '../db.js'
import { buildExportCsv, exportedPeople, MIN_AUDIENCE, type ExportRow } from '../lib/exporters.js'
import { exportSchema, segmentFiltersSchema, segmentSchema, type SegmentFilters } from '../lib/schemas.js'
import { buildSegmentWhere } from '../lib/segments.js'

/** Segments (saved audience definitions) and platform match-list exports. */
export const audienceRoutes = new Hono<AuthEnv>()

async function countSegment(filters: SegmentFilters) {
  const { where, params } = buildSegmentWhere(filters)
  const [row] = await query<{ total: number; with_email: number; with_phone: number }>(
    `SELECT count(*)::int AS total, count(c.email)::int AS with_email, count(c.phone)::int AS with_phone
       FROM customers c WHERE ${where}`,
    params,
  )
  return row
}

audienceRoutes.get('/segments', async (c) => {
  const segments = await query<{ id: string; filters: SegmentFilters }>('SELECT * FROM segments ORDER BY created_at DESC')
  const withCounts = await Promise.all(segments.map(async (s) => ({ ...s, size: await countSegment(s.filters) })))
  return c.json(withCounts)
})

audienceRoutes.post('/segments/preview', async (c) => {
  const filters = segmentFiltersSchema.parse(await c.req.json())
  return c.json({ size: await countSegment(filters), minimums: MIN_AUDIENCE })
})

audienceRoutes.post('/segments', async (c) => {
  const b = segmentSchema.parse(await c.req.json())
  const [row] = await query(
    'INSERT INTO segments (name, description, filters, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
    [b.name, b.description ?? null, b.filters, c.get('actor')],
  )
  return c.json(row, 201)
})

audienceRoutes.delete('/segments/:id', async (c) => {
  await query('DELETE FROM segments WHERE id = $1', [z.uuid().parse(c.req.param('id'))])
  return c.body(null, 204)
})

audienceRoutes.get('/exports', async (c) =>
  c.json(await query('SELECT * FROM exports ORDER BY created_at DESC LIMIT 200')),
)

/** Generates a hashed match-list CSV for one platform and logs the export. */
audienceRoutes.post('/exports', async (c) => {
  const b = exportSchema.parse(await c.req.json())
  const [segment] = await query<{ id: string; name: string; filters: SegmentFilters }>(
    'SELECT * FROM segments WHERE id = $1',
    [b.segment_id],
  )
  if (!segment) throw new HTTPException(404, { message: 'Segment not found' })

  // Sending to ad platforms for targeting requires the ad personalisation purpose.
  const { where, params } = buildSegmentWhere({ ...segment.filters, requireAdPersonalization: true })
  const rows = await query<ExportRow>(
    `SELECT c.email, c.phone, c.first_name, c.last_name, c.city, c.country, c.gender, c.email_status, c.phone_status
       FROM customers c WHERE ${where}`,
    params,
  )
  const csv = buildExportCsv(b.platform, rows, b.identifier)
  const recordCount = exportedPeople(b.platform, rows, b.identifier)

  const [exp] = await query<{ id: string }>(
    `INSERT INTO exports (segment_id, segment_name, platform, identifier, record_count, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [segment.id, segment.name, b.platform, b.identifier, recordCount, c.get('actor')],
  )
  await audit(c.get('actor'), 'export', 'segment', segment.id, { platform: b.platform, records: recordCount })

  const filename = `retrgtr-${b.platform}-${segment.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`
  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'X-Export-Id': exp.id,
    'X-Record-Count': String(recordCount),
  })
})
