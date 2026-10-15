import pg from 'pg'
import { config } from './config.js'

// Return DATE columns as 'YYYY-MM-DD' strings instead of timezone-shifted JS Dates.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v)

export const pool = new pg.Pool({ ...config.db, max: 10 })

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params)
  return res.rows
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function audit(actor: string, action: string, entity: string, entityId?: string, meta = {}) {
  await query('INSERT INTO audit_log (actor, action, entity, entity_id, meta) VALUES ($1, $2, $3, $4, $5)', [
    actor,
    action,
    entity,
    entityId ?? null,
    meta,
  ])
}
