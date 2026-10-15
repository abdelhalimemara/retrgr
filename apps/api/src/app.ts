import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { ZodError } from 'zod'
import { requireAdmin, type AuthEnv } from './auth.js'
import { config } from './config.js'
import { attributionRoutes } from './routes/attribution.js'
import { audienceRoutes } from './routes/audiences.js'
import { catalogRoutes } from './routes/catalog.js'
import { customerRoutes } from './routes/customers.js'
import { ingestRoutes } from './routes/ingest.js'
import { publicRoutes } from './routes/public.js'

export const app = new Hono()

app.use(secureHeaders())
app.use(bodyLimit({ maxSize: 64 * 1024 }))

// Cloud Run reserves /healthz at the Google front end, so /health is the public probe.
app.get('/health', (c) => c.json({ ok: true }))
app.get('/healthz', (c) => c.json({ ok: true }))

// Public endpoints are called from landing pages (collector / hosted page) or the sGTM
// Retrgtr Client — any origin, no credentials.
app.use('/api/public/*', cors({ origin: '*', allowMethods: ['GET', 'POST'] }))
app.route('/api/public', publicRoutes)
app.route('/api/public', ingestRoutes)

// Admin endpoints: dashboard origin only, Firebase ID token required.
const admin = new Hono<AuthEnv>()
admin.use(
  cors({ origin: config.adminOrigins, allowHeaders: ['Authorization', 'Content-Type'], exposeHeaders: ['X-Record-Count'] }),
)
admin.use(requireAdmin)
admin.route('/', catalogRoutes)
admin.route('/', customerRoutes)
admin.route('/', audienceRoutes)
admin.route('/', attributionRoutes)
app.route('/api/admin', admin)

app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ error: 'Validation failed', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 400)
  }
  if (err instanceof HTTPException) return c.json({ error: err.message || 'Error' }, err.status)
  if ((err as { code?: string }).code === '23505') return c.json({ error: 'Already exists' }, 409)
  console.error(err)
  return c.json({ error: 'Internal error' }, 500)
})
