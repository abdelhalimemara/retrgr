import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'

/** True when the request came through the sGTM Retrgtr Client (shared secret matches). */
export function viaSgtm(c: Context): boolean {
  const key = c.req.header('X-Retrgtr-Key')
  if (!config.sgtmSecret || !key) return false
  const a = Buffer.from(key)
  const b = Buffer.from(config.sgtmSecret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Real client IP. Behind sGTM the request comes from the tagging server, so the
 * client forwards the visitor's IP in X-Retrgtr-Client-IP. Otherwise Cloud Run's
 * front end appends the client IP as the last X-Forwarded-For entry.
 */
export function clientIp(c: Context): string | null {
  if (viaSgtm(c)) return c.req.header('X-Retrgtr-Client-IP')?.trim() || null
  return c.req.header('X-Forwarded-For')?.split(',').pop()?.trim() || null
}

export function clientUserAgent(c: Context): string | null {
  return (viaSgtm(c) ? c.req.header('X-Retrgtr-User-Agent') : c.req.header('User-Agent'))?.slice(0, 500) ?? null
}

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python|axios|node-fetch/i
export const isBot = (ua: string | null) => !ua || BOT_UA.test(ua)

/**
 * Per-instance fixed-window limiter for public endpoints. Cloud Run scales
 * horizontally, so this is a first line of defence — put Cloud Armor
 * rate-limiting in front of the service for a global limit.
 */
export function rateLimit({ windowMs, max }: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>()

  return createMiddleware(async (c, next) => {
    const now = Date.now()
    const ip = clientIp(c) ?? 'unknown'
    const entry = hits.get(ip)
    if (!entry || entry.resetAt <= now) {
      hits.set(ip, { count: 1, resetAt: now + windowMs })
      if (hits.size > 50_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
    } else if (++entry.count > max) {
      throw new HTTPException(429, { message: 'Too many requests' })
    }
    await next()
  })
}
