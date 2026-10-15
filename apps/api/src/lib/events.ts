import { BigQuery } from '@google-cloud/bigquery'
import { config } from '../config.js'

/**
 * Raw event store in BigQuery (dataset in me-central2). Rows carry no direct
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
      location: 'me-central2',
    })
  }
}
