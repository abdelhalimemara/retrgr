import { serve } from '@hono/node-server'
import { app } from './app.js'
import { config } from './config.js'
import { pool } from './db.js'

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`retrgtr api listening on :${info.port}`)
  if (config.authDevBypass) console.warn('AUTH_DEV_BYPASS is on — admin endpoints are unauthenticated')
})

// Cloud Run sends SIGTERM before shutting an instance down.
process.on('SIGTERM', () => {
  server.close(() => void pool.end().then(() => process.exit(0)))
})
