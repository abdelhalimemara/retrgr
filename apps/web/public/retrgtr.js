/*!
 * Retrgtr collector v2 — install as a GTM Custom HTML tag on the QR landing page:
 *
 *   <script src="https://YOUR-DASHBOARD-HOST/retrgtr.js"
 *           data-endpoint="https://YOUR-SGTM-HOST"   (sGTM tagging server; or the API host)
 *           data-path="/retrgtr"                     ("/retrgtr" via sGTM, "/api/public" direct to API)
 *           data-campaign="campaign-slug" data-policy-version="v1" async></script>
 *
 * In GTM, give the tag Additional Consent Checks → `analytics_storage` so it only
 * loads once analytics consent is granted. Loading the script = consent given.
 *
 * Billboard QR URLs: /landing?bid=<placement-code>&v=<offer-variant>&utm_source=ooh…
 *
 * What it does:
 *  - scan:        device/context snapshot + repeat-exposure counter → POST {path}/scan
 *  - engagement:  dwell, scroll, CTA clicks, scan→action, form drop-off → beacon on pagehide
 *  - capture:     forms marked `data-retrgtr-form` → POST {path}/capture (needs marketing consent box)
 * Form fields are read from an ALLOWLIST only — nothing else on the form is ever sent.
 * Nothing goes to the dataLayer except non-identifying event names and placement codes.
 */
(function () {
  'use strict'
  if (window.retrgtr) return
  var s = document.currentScript
  var attr = function (n, d) {
    return (s && s.getAttribute(n)) || d
  }
  var pathAttr = s && s.getAttribute('data-path')
  var ENDPOINT = attr('data-endpoint', '').replace(/\/$/, '') + (pathAttr == null ? '/retrgtr' : pathAttr)
  var CAMPAIGN = attr('data-campaign', '')
  var POLICY = attr('data-policy-version', 'v1')
  var URL_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid', 'sccid']
  var FORM_FIELDS = ['email', 'phone', 'first_name', 'last_name', 'age_range', 'gender', 'city']
  var CTX_KEY = 'retrgtr_ctx'

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >> 0
      return (c === 'x' ? r : (r & 3) | 8).toString(16)
    })
  }
  function store(kind, key, val) {
    try {
      if (val === undefined) return window[kind].getItem(key)
      window[kind].setItem(key, val)
    } catch (e) {}
    return null
  }
  function push(data) {
    window.dataLayer = window.dataLayer || []
    window.dataLayer.push(data)
  }
  function send(path, body, beacon) {
    var json = JSON.stringify(body)
    if (beacon && navigator.sendBeacon) return navigator.sendBeacon(ENDPOINT + path, json)
    return fetch(ENDPOINT + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
      keepalive: true,
    })
  }

  // ---- placement + campaign context (persisted for the session so in-site navigation keeps it) ----
  var qs = new URLSearchParams(location.search)
  var ctx = {}
  try {
    ctx = JSON.parse(store('sessionStorage', CTX_KEY) || '{}')
  } catch (e) {}
  URL_PARAMS.forEach(function (p) {
    if (qs.get(p)) ctx[p] = qs.get(p).slice(0, 500)
  })
  var bid = (qs.get('bid') || ctx.bid || '').toLowerCase() || null
  var variant = qs.get('v') || ctx.offer_variant || null
  ctx.bid = bid
  ctx.offer_variant = variant
  // Origin + path only: query strings can carry PII.
  ctx.landing_url = ctx.landing_url || location.origin + location.pathname
  if (!ctx.referrer && document.referrer) ctx.referrer = document.referrer.split('?')[0]
  var isNewSession = !ctx.scan_id
  ctx.scan_id = ctx.scan_id || uuid()
  store('sessionStorage', CTX_KEY, JSON.stringify(ctx))

  // ---- repeat exposure: first-party, consent-gated (this script only runs after consent) ----
  var visitorId = store('localStorage', 'retrgtr_vid') || uuid()
  store('localStorage', 'retrgtr_vid', visitorId)
  var priorBids = []
  try {
    priorBids = JSON.parse(store('localStorage', 'retrgtr_bids') || '[]')
  } catch (e) {}
  var scanNumber = parseInt(store('localStorage', 'retrgtr_scans') || '0', 10)
  if (isNewSession) {
    scanNumber += 1
    store('localStorage', 'retrgtr_scans', String(scanNumber))
    if (bid && priorBids.indexOf(bid) === -1) store('localStorage', 'retrgtr_bids', JSON.stringify(priorBids.concat(bid).slice(-50)))
  }

  function deviceType() {
    var ua = navigator.userAgent
    if (/iPad|Tablet|(Android(?!.*Mobile))/i.test(ua)) return 'tablet'
    if (/Mobi|iPhone|Android/i.test(ua)) return 'mobile'
    return 'desktop'
  }

  function context() {
    var tz = null
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch (e) {}
    var c = { device_type: deviceType(), language: navigator.language || null, timezone: tz }
    URL_PARAMS.concat(['landing_url', 'referrer']).forEach(function (k) {
      if (ctx[k]) c[k] = ctx[k]
    })
    return c
  }

  function device(hints) {
    var ua = navigator.userAgentData || {}
    var scr = window.screen || {}
    var conn = navigator.connection || {}
    return {
      os: hints.platform || ua.platform || (/(iPhone|iPad|iPod)/.test(navigator.userAgent) ? 'iOS' : /Android/.test(navigator.userAgent) ? 'Android' : null),
      os_version: hints.platformVersion || null,
      model: hints.model || null,
      browser: ua.brands ? ua.brands.map(function (b) { return b.brand + ' ' + b.version }).join(', ').slice(0, 200) : null,
      screen_w: scr.width || null,
      screen_h: scr.height || null,
      viewport_w: window.innerWidth || null,
      viewport_h: window.innerHeight || null,
      pixel_ratio: window.devicePixelRatio || null,
      orientation: (scr.orientation && scr.orientation.type) || null,
      connection_type: conn.effectiveType || null,
      languages: navigator.languages ? navigator.languages.join(',').slice(0, 200) : null,
      touch_points: navigator.maxTouchPoints || 0,
    }
  }

  // ---- scan (once per session) ----
  function sendScan(hints) {
    if (!CAMPAIGN) return
    send('/scan', {
      scan_id: ctx.scan_id,
      visitor_id: visitorId,
      campaign: CAMPAIGN,
      bid: bid,
      offer_variant: variant,
      scan_number: Math.max(scanNumber, 1),
      prior_bids: priorBids.filter(function (b) { return b !== bid }),
      consent: { analytics: true, policy_version: POLICY },
      context: context(),
      device: device(hints || {}),
    })
    push({ event: 'ooh_scan', ooh_bid: bid, ooh_scan_number: scanNumber, ooh_offer_variant: variant })
  }
  if (isNewSession) {
    var uad = navigator.userAgentData
    if (uad && uad.getHighEntropyValues) {
      uad.getHighEntropyValues(['platform', 'platformVersion', 'model']).then(sendScan, function () { sendScan() })
    } else sendScan()
  }

  // ---- engagement ----
  var start = Date.now()
  var maxScroll = 0
  var ctaClicks = 0
  var firstActionTs = null
  var formStarted = false
  var formSubmitted = false
  var lastField = null
  function action() {
    if (!firstActionTs) firstActionTs = Date.now()
  }
  window.addEventListener(
    'scroll',
    function () {
      var h = document.documentElement.scrollHeight || document.body.scrollHeight
      var p = Math.round(((window.scrollY + window.innerHeight) / h) * 100)
      if (p > maxScroll) maxScroll = Math.min(p, 100)
    },
    { passive: true },
  )
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-cta]')) {
      ctaClicks++
      action()
    }
  })
  document.addEventListener('focusin', function (e) {
    var f = e.target.form
    if (f && f.hasAttribute('data-retrgtr-form') && e.target.name) {
      formStarted = true
      lastField = String(e.target.name).slice(0, 40) // field name only, never its value
      action()
    }
  })
  var flushed = 0
  function flush() {
    var dwell = Math.round((Date.now() - start) / 1000)
    if (dwell === flushed) return
    flushed = dwell
    var body = {
      scan_id: ctx.scan_id,
      dwell_seconds: Math.min(dwell, 86400),
      max_scroll_pct: maxScroll,
      cta_clicks: ctaClicks,
      scan_to_action_ms: firstActionTs ? firstActionTs - start : null,
      form_started: formStarted,
      form_submitted: formSubmitted,
      last_field: formSubmitted ? null : lastField,
    }
    send('/engagement', body, true)
    push({ event: 'ooh_engagement', ooh_dwell_seconds: body.dwell_seconds, ooh_max_scroll_pct: maxScroll, ooh_cta_clicks: ctaClicks })
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) flush()
  })
  window.addEventListener('pagehide', flush)

  // ---- lead capture ----
  function capture(fields) {
    if (!fields.consent_marketing) return Promise.reject(new Error('Marketing consent is required'))
    var body = {
      campaign: fields.campaign || CAMPAIGN,
      bid: bid,
      scan_id: ctx.scan_id,
      visitor_id: visitorId,
      consent: { marketing: true, ad_personalization: !!fields.consent_ad_personalization, policy_version: POLICY },
      context: context(),
    }
    FORM_FIELDS.forEach(function (k) {
      body[k] = fields[k] || null
    })
    action()
    return send('/capture', body).then(function (res) {
      if (!res.ok) {
        return res.json().then(
          function (j) { throw new Error(j.error || 'Submission failed') },
          function () { throw new Error('Submission failed') },
        )
      }
      formSubmitted = true
      push({ event: 'ooh_lead', ooh_bid: bid, ooh_ad_personalization: !!fields.consent_ad_personalization })
    })
  }

  function bind(form) {
    if (form.__retrgtr) return
    form.__retrgtr = true
    form.addEventListener('submit', function (e) {
      e.preventDefault()
      var fields = { campaign: form.getAttribute('data-retrgtr-form') || CAMPAIGN }
      FORM_FIELDS.forEach(function (k) {
        var el = form.elements[k]
        if (el && typeof el.value === 'string' && el.value.trim()) fields[k] = el.value.trim().slice(0, 254)
      })
      fields.consent_marketing = !!(form.elements.consent_marketing && form.elements.consent_marketing.checked)
      fields.consent_ad_personalization = !!(form.elements.consent_ad_personalization && form.elements.consent_ad_personalization.checked)
      capture(fields).then(
        function () { form.dispatchEvent(new CustomEvent('retrgtr:success')) },
        function (err) { form.dispatchEvent(new CustomEvent('retrgtr:error', { detail: err.message })) },
      )
    })
  }
  function scan() {
    document.querySelectorAll('form[data-retrgtr-form]').forEach(bind)
  }

  window.retrgtr = { capture: capture, scan: scan, scanId: ctx.scan_id }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan)
  else scan()
})()
