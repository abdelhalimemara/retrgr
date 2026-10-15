// Downloads the free DB-IP "Lite" city + ASN databases (CC BY 4.0, no account needed) into
// apps/api/geo/. Run at image build time (and once locally). If the download fails, the API
// still works — IP enrichment is simply skipped.
// Attribution (required by the licence): "IP Geolocation by DB-IP" — https://db-ip.com
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

const dir = process.argv[2] ?? 'geo'
mkdirSync(dir, { recursive: true })
const month = (offset) => {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - offset)
  return d.toISOString().slice(0, 7)
}

for (const kind of ['city', 'asn']) {
  let done = false
  for (const m of [month(0), month(1)]) {
    const url = `https://download.db-ip.com/free/dbip-${kind}-lite-${m}.mmdb.gz`
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      writeFileSync(join(dir, `dbip-${kind}-lite.mmdb`), gunzipSync(Buffer.from(await res.arrayBuffer())))
      console.log(`geo: ${kind} ${m} ok`)
      done = true
      break
    } catch (err) {
      console.warn(`geo: ${url} failed: ${err.message}`)
    }
  }
  if (!done) console.warn(`geo: no ${kind} database — IP enrichment for ${kind} disabled`)
}
