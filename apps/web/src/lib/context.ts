/** Same first-party context the GTM collector (public/retrgtr.js) gathers, for the hosted consent page. */
const PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid', 'sccid']

export function readCaptureContext(): Record<string, string> {
  const qs = new URLSearchParams(window.location.search)
  const ctx: Record<string, string> = {}
  for (const p of PARAMS) {
    const v = qs.get(p)
    if (v) ctx[p] = v.slice(0, 500)
  }
  const ua = navigator.userAgent
  ctx.device_type = /iPad|Tablet|(Android(?!.*Mobile))/i.test(ua) ? 'tablet' : /Mobi|iPhone|Android/i.test(ua) ? 'mobile' : 'desktop'
  ctx.landing_url = window.location.origin + window.location.pathname
  if (document.referrer) ctx.referrer = document.referrer.split('?')[0]
  ctx.language = navigator.language
  ctx.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return ctx
}
