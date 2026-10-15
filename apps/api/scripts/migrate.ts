import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pool } from '../src/db.js'

// Run from apps/api (npm run migrate) or the container's WORKDIR.
const dir = path.resolve(process.env.MIGRATIONS_DIR ?? 'migrations')

async function main() {
  const { rows } = await pool
    .query<{ name: string }>('SELECT name FROM schema_migrations')
    .catch(() => ({ rows: [] as { name: string }[] }))
  const applied = new Set(rows.map((r) => r.name))

  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(await readFile(path.join(dir, file), 'utf8'))
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
      console.log(`applied ${file}`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
