import { BigQuery } from '@google-cloud/bigquery'
import type { PoolClient } from 'pg'
import { config } from '../config.js'
import { query } from '../db.js'

/**
 * Raw event store in BigQuery (dataset in BQ_LOCATION). Rows carry no direct
 * identifiers — only scan_id / visitor_id — so the analytics layer stays
 * pseudonymous. The scan → customer link lives in Cloud SQL.
 */
export type EventTable = 'scan_events' | 'engagement_events'

let client: BigQuery | null = null
const bq = () => (client ??= new BigQuery({ projectId: config.bigquery.projectId }))

export const eventsEnabled = () => Boolean(config.bigquery.dataset)

export async function writeEvent(table: EventTable, row: Record<string, unknown>, insertId = String(row.scan_id)) {
  if (!eventsEnabled()) return
  try {
    // insertId gives best-effort de-duplication of retried requests / beacons.
    await bq()
      .dataset(config.bigquery.dataset)
      .table(table)
      .insert([{ insertId: `${table}:${insertId}`, json: row }], { raw: true, ignoreUnknownValues: true })
  } catch (err) {
    // Analytics must never break capture; log and move on.
    console.error(`bigquery insert into ${table} failed`, err)
  }
}

/** Erasure support: removes a person's scan events from BigQuery. */
export async function deleteEvents(scanIds: string[]) {
  if (!eventsEnabled() || !scanIds.length) return
  const ds = `\`${config.bigquery.projectId}.${config.bigquery.dataset}\``
  for (const table of ['scan_events', 'engagement_events'] as const) {
    await bq().query({
      query: `DELETE FROM ${ds}.${table} WHERE scan_id IN UNNEST(@ids)`,
      params: { ids: scanIds },
      location: config.bigquery.location,
    })
  }
}

/** Queues scan ids whose BigQuery events must be erased (call inside the erase transaction). */
export async function queueEventErasure(client: PoolClient, scanIds: string[]) {
  if (!eventsEnabled() || !scanIds.length) return
  await client.query(
    'INSERT INTO event_erasures (scan_id) SELECT unnest($1::uuid[]) ON CONFLICT DO NOTHING',
    [scanIds],
  )
}

/**
 * Attempts the queued BigQuery deletions (all, or just `scanIds`). Rows still in the
 * streaming buffer fail and stay queued for the next run. Never throws.
 */
export async function flushEventErasures(scanIds?: string[]): Promise<{ erased: number; pending: number }> {
  if (!eventsEnabled()) return { erased: 0, pending: 0 }
  const rows = await query<{ scan_id: string }>(
    scanIds
      ? 'SELECT scan_id FROM event_erasures WHERE scan_id = ANY($1::uuid[])'
      : 'SELECT scan_id FROM event_erasures ORDER BY requested_at LIMIT 10000',
    scanIds ? [scanIds] : [],
  )
  const ids = rows.map((r) => r.scan_id)
  if (!ids.length) return { erased: 0, pending: 0 }
  try {
    await deleteEvents(ids)
    await query('DELETE FROM event_erasures WHERE scan_id = ANY($1::uuid[])', [ids])
    return { erased: ids.length, pending: 0 }
  } catch (err) {
    const message = String((err as Error).message ?? err).slice(0, 500)
    await query('UPDATE event_erasures SET attempts = attempts + 1, last_error = $2 WHERE scan_id = ANY($1::uuid[])', [
      ids,
      message,
    ]).catch(() => {})
    return { erased: 0, pending: ids.length }
  }
}
