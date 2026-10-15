import { pool, query } from '../src/db.js'
import { flushEventErasures } from '../src/lib/events.js'
import { validateContacts } from '../src/lib/validation.js'

// Hourly Cloud Run job (retrgtr-erasures, via Cloud Scheduler):
//  1. retry BigQuery erasures refused while rows sat in the streaming buffer;
//  2. validate new contacts (and re-check ones older than 180 days).
async function main() {
  const erasures = await flushEventErasures()
  const validation = await validateContacts(Number(process.env.VALIDATION_BATCH ?? 500))
  // 3. delete partial leads (entries saved as typed) older than 30 days.
  const expired = await query('DELETE FROM partial_leads WHERE expires_at < now() RETURNING scan_id')
  console.log(JSON.stringify({ erasures, validation, partial_leads_expired: expired.length }))
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
