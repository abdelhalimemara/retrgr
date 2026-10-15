import { Hono } from 'hono'
import { config } from '../config.js'
import { query } from '../db.js'
import { clientUserAgent, isBot } from '../lib/request.js'

/**
 * QR redirect links for client-owned landing pages: /q/:code → the client's page with
 * bid + UTMs added, so the collector on that page can attribute the billboard.
 * Each open increments a daily counter (no IP, device or cookie is stored).
 */
export const redirectRoutes = new Hono()

redirectRoutes.get('/:code', async (c) => {
  const code = c.req.param('code').toLowerCase()
  if (!/^[a-z0-9-]{2,40}$/.test(code)) return c.text('Not found', 404)
  const [pl] = await query<{ id: string; destination_url: string | null; slug: string }>(
    `SELECT pl.id, pl.destination_url, cp.slug
       FROM placements pl JOIN campaigns cp ON cp.id = pl.campaign_id WHERE pl.code = $1`,
    [code],
  )
  if (!pl) return c.text('Not found', 404)

  // Printed QR codes outlive campaigns: always redirect, whatever the campaign status.
  const target = new URL(pl.destination_url ?? `${config.adminOrigins[0]}/c/${pl.slug}`)
  const set = (k: string, v: string) => !target.searchParams.has(k) && target.searchParams.set(k, v)
  target.searchParams.set('bid', code)
  set('utm_source', 'ooh')
  set('utm_medium', 'qr')
  set('utm_campaign', pl.slug)

  if (!isBot(clientUserAgent(c))) {
    await query(
      `INSERT INTO qr_opens (placement_id, day, opens) VALUES ($1, (now() AT TIME ZONE 'Asia/Riyadh')::date, 1)
       ON CONFLICT (placement_id, day) DO UPDATE SET opens = qr_opens.opens + 1`,
      [pl.id],
    ).catch((err) => console.error('qr open count failed', err)) // never block the redirect
  }
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  return c.redirect(target.toString(), 302)
})
