import { pool, query } from '../src/db.js'
import { eventsEnabled, flushEventErasures } from '../src/lib/events.js'

// Retries queued BigQuery erasures. Runs as the retrgtr-erasures Cloud Run job on a schedule.
// Extra scan ids passed as arguments are queued first (manual recovery).
async function main() {
  if (!eventsEnabled()) {
    console.log('BQ_DATASET not set; nothing to do')
    return
  }
  const extra = process.argv.slice(2)
  if (extra.length) {
    await query('INSERT INTO event_erasures (scan_id) SELECT unnest($1::uuid[]) ON CONFLICT DO NOTHING', [extra])
  }
  const result = await flushEventErasures()
  console.log(JSON.stringify(result))
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
