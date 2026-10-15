/*!
 * Retrgtr collector v3 — install as a GTM Custom HTML tag on the QR landing page:
 *
 *   <script src="https://YOUR-DASHBOARD-HOST/retrgtr.js"
 *           data-endpoint="https://YOUR-SGTM-HOST"   (the central Retrgtr sGTM; or the API host)
 *           data-path="/retrgtr"                     ("/retrgtr" via sGTM, "/api/public" direct to API)
 *           data-partner="PARTNER-KEY" data-policy-version="v1" async></script>
 *
 * One snippet per partner, in the partner's own GTM. The campaign is resolved from the
 * billboard code (bid) in the QR URL, else the partner's active campaign. Optional
 * data-campaign="slug" pins a campaign. Requests are only accepted from the websites
 * registered for the partner in the dashboard.
 *
 * Optional:
 *   data-marketing-consent="checkbox" (default) marketing opt-in = a ticked consent checkbox on the form
 *                          "submit"   the form's own wording is the opt-in, so submitting it counts
 *   data-forms="auto" (default) | "off"     data-datalayer="on" (default) | "off"
 *
 * In GTM, give the tag Additional Consent Checks → `analytics_storage` so it only
 * loads once analytics consent is granted. Loading the script = analytics consent given.
 *
 * Billboard QR URLs: /landing?bid=<placement-code>&v=<offer-variant>&utm_source=ooh…
 *
 * What it does:
 *  - scan:        device/context snapshot + repeat-exposure counter → POST {path}/scan
 *  - engagement:  dwell, scroll, CTA clicks, scan→action, form drop-off → beacon on pagehide
 *  - forms:       ANY form submitted on the page that contains an email or phone is read
 *                 automatically (no markup changes) → POST {path}/capture. Fields are mapped
 *                 by type/autocomplete/name/label (EN + AR). Passwords, hidden fields, card
 *                 numbers and national IDs are never read; login forms are skipped. The page's
 *                 own submit is never blocked. Leads without a marketing opt-in are stored but
 *                 never exported or sent to ad platforms.
 *  - dataLayer:   every push (existing + future) is batched → POST {path}/datalayer, with
 *                 personal values redacted (again server-side) before it reaches BigQuery.
 * Personal data is only ever sent to the endpoint above — never to the dataLayer.
 * Add data-retrgtr-ignore to a form to exclude it.
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
  var CAMPAIGN = attr('data-campaign', '') || null
  var PARTNER = attr('data-partner', '') || null
  var POLICY = attr('data-policy-version', 'v1')
  var URL_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid', 'sccid']
  var FORM_FIELDS = ['email', 'phone', 'first_name', 'last_name', 'age_range', 'gender', 'city']
  var CONSENT_MODE = attr('data-marketing-consent', 'checkbox')
  var AUTO_FORMS = attr('data-forms', 'auto') !== 'off'
  var DATALAYER = attr('data-datalayer', 'on') !== 'off'
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
  // Settles once the scan is recorded, so a fast lead can be linked to its billboard.
  var scanResolve
  var scanDone = new Promise(function (r) { scanResolve = r })
  function sendScan(hints) {
    if (!CAMPAIGN && !PARTNER && !bid) return scanResolve()
    var req = send('/scan', {
      scan_id: ctx.scan_id,
      visitor_id: visitorId,
      campaign: CAMPAIGN,
      partner: PARTNER,
      bid: bid,
      offer_variant: variant,
      scan_number: Math.max(scanNumber, 1),
      prior_bids: priorBids.filter(function (b) { return b !== bid }),
      consent: { analytics: true, policy_version: POLICY },
      context: context(),
      device: device(hints || {}),
    })
    Promise.resolve(req).then(scanResolve, scanResolve)
    push({ event: 'ooh_scan', ooh_bid: bid, ooh_scan_number: scanNumber, ooh_offer_variant: variant })
  }
  if (isNewSession) {
    var uad = navigator.userAgentData
    if (uad && uad.getHighEntropyValues) {
      uad.getHighEntropyValues(['platform', 'platformVersion', 'model']).then(sendScan, function () { sendScan() })
    } else sendScan()
  } else scanResolve() // scan already recorded earlier in this session

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
    if (f && !f.hasAttribute('data-retrgtr-ignore') && (e.target.name || e.target.id)) {
      formStarted = true
      lastField = String(e.target.name || e.target.id).slice(0, 40) // field name only, never its value
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
    var marketing = !!fields.consent_marketing
    var body = {
      campaign: fields.campaign || CAMPAIGN,
      partner: PARTNER,
      bid: bid,
      scan_id: ctx.scan_id,
      visitor_id: visitorId,
      source: fields.source || 'hosted',
      form_id: fields.form_id || null,
      extra: fields.extra || null,
      consent: { analytics: true, marketing: marketing, ad_personalization: marketing && !!fields.consent_ad_personalization, policy_version: POLICY },
      context: context(),
    }
    FORM_FIELDS.forEach(function (k) {
      body[k] = fields[k] || null
    })
    action()
    // Wait (max 1.5s) for the scan so the server can link this lead to the billboard.
    var waitScan = Promise.race([scanDone, new Promise(function (r) { setTimeout(r, 1500) })])
    return waitScan.then(function () { return send('/capture', body) }).then(function (res) {
      if (!res.ok) {
        return res.json().then(
          function (j) { throw new Error(j.error || 'Submission failed') },
          function () { throw new Error('Submission failed') },
        )
      }
      formSubmitted = true
      push({ event: 'ooh_lead', ooh_bid: bid, ooh_marketing_consent: marketing, ooh_ad_personalization: body.consent.ad_personalization })
    })
  }

  // ---- automatic form capture (any form on the page; no markup changes needed) ----
  var SKIP_TYPES = /^(password|hidden|file|submit|button|reset|image)$/
  var SENSITIVE = /pass|pwd|secret|token|csrf|captcha|(^|[_-\s])otp($|[_-\s])|cvv|cvc|card|iban|ssn|national.?id|iqama|passport|هوية|إقامة|اقامة|جواز|بطاقة|كلمة.?المرور/i
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  var AD_RE = /\bads?\b|advert|personali[sz]|social media|retarget|إعلان|اعلان|الإعلانات/i
  var MARKETING_RE = /market|newsletter|offer|promot|updates|communicat|contact me|subscribe|news|تسويق|عروض|النشرة|التواصل|الاشتراك|رسائل/i

  function labelOf(el) {
    var lab = (el.labels && el.labels[0]) || (el.closest && el.closest('label'))
    var t = ''
    if (lab) {
      // Label text without the text of controls nested inside it (e.g. a select's options).
      var copy = lab.cloneNode(true)
      Array.prototype.forEach.call(copy.querySelectorAll('input, select, textarea, button'), function (n) { n.remove() })
      t = copy.textContent
    }
    t = (t && t.trim()) || el.getAttribute('aria-label') || el.placeholder || ''
    return String(t).replace(/\s+/g, ' ').trim().slice(0, 300)
  }
  function classify(el, label) {
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase()
    var key = [el.name, el.id, ac, label].join(' ').toLowerCase()
    if (el.type === 'email' || ac === 'email' || /e-?mail|بريد/.test(key)) return 'email'
    if (el.type === 'tel' || /^tel/.test(ac) || /phone|mobile|\btel\b|whats|جوال|هاتف/.test(key)) return 'phone'
    if (ac === 'given-name' || /first|given|(^|[\s_-])fname\b|الاسم الأول/.test(key)) return 'first_name'
    if (ac === 'family-name' || /last|surname|family|(^|[\s_-])lname\b|اسم العائلة/.test(key)) return 'last_name'
    if (/gender|\bsex\b|الجنس/.test(key)) return 'gender'
    if (ac === 'bday' || /\bage\b|birth|dob|عمر|العمر|ميلاد/.test(key)) return 'age_range'
    if (ac === 'address-level2' || /city|town|مدينة|المدينة/.test(key)) return 'city'
    if (/company|business|organi[sz]|brand|store|شركة|منشأة|الجهة/.test(key)) return null
    if (ac === 'name' || /(^|\s)(full.?)?name(\s|$)|الاسم|اسم/.test(key)) return 'full_name'
    return null
  }

  /** Reads a form into capture fields, or null when there's no email/phone to identify the person. */
  function readForm(form) {
    if (form.closest('[data-retrgtr-ignore]') || form.querySelector('input[type=password]')) return null
    var f = { source: 'auto', extra: {}, consent_marketing: CONSENT_MODE === 'submit', consent_ad_personalization: false }
    var extras = 0
    // `form` may also be a plain container (div-based SPA forms without a <form> tag).
    var fields = form.elements || form.querySelectorAll('input, select, textarea')
    Array.prototype.forEach.call(fields, function (el) {
      if (!el.name && !el.id) return
      var type = (el.type || '').toLowerCase()
      if (SKIP_TYPES.test(type) || el.disabled) return
      var label = labelOf(el)
      if (SENSITIVE.test([el.name, el.id, el.getAttribute('autocomplete'), label].join(' '))) return
      if (type === 'checkbox') {
        if (!el.checked) return
        if (AD_RE.test(label)) f.consent_ad_personalization = f.consent_marketing = true
        else if (MARKETING_RE.test(label)) f.consent_marketing = true
        else if (extras < 30) (f.extra[(label || el.name || el.id).slice(0, 80)] = el.value && el.value !== 'on' ? el.value : 'yes'), extras++
        return
      }
      if (type === 'radio' && !el.checked) return
      var value = el.tagName === 'SELECT' && el.selectedIndex >= 0 ? el.options[el.selectedIndex].text || el.value : el.value
      value = typeof value === 'string' ? value.trim().slice(0, 500) : ''
      if (!value) return
      var kind = classify(el, label) || (EMAIL_RE.test(value) ? 'email' : null)
      if (kind === 'full_name') {
        var parts = value.split(/\s+/)
        f.first_name = f.first_name || parts.shift()
        if (parts.length) f.last_name = f.last_name || parts.join(' ')
      } else if (kind === 'age_range' && el.tagName === 'SELECT') f.age_range = f.age_range || el.value || value
      else if (kind && !f[kind]) f[kind] = kind === 'email' || kind === 'phone' ? value.slice(0, kind === 'email' ? 254 : 32) : value
      else if (extras < 30) (f.extra[(label || el.name || el.id).slice(0, 80)] = value), extras++
    })
    if (!f.email && !f.phone) return null
    if (f.email && !EMAIL_RE.test(f.email)) delete f.email
    if (!f.email && !f.phone) return null
    var action = form.getAttribute('action') || ''
    f.form_id = (form.id || form.getAttribute('name') || action.split('?')[0] || 'form').slice(0, 120)
    return f
  }

  var recent = {}
  function autoCapture(form) {
    var f = readForm(form)
    if (!f) return
    // Same answers within 10s = one submission seen twice (click + submit); changed answers are re-sent.
    var sig = JSON.stringify(f)
    if (recent[sig] && Date.now() - recent[sig] < 10000) return
    recent[sig] = Date.now()
    capture(f).then(
      function () { form.dispatchEvent(new CustomEvent('retrgtr:success')) },
      function (err) { form.dispatchEvent(new CustomEvent('retrgtr:error', { detail: err.message })) },
    )
  }
  if (AUTO_FORMS) {
    // Capture phase, never preventDefault: the partner's own submit handling runs untouched.
    document.addEventListener('submit', function (e) { if (e.target && e.target.tagName === 'FORM') autoCapture(e.target) }, true)
    // Forms sent by JavaScript (SPA/AJAX) often never fire `submit`, use type="button",
    // or have no <form> at all. A click on a submit-looking button reads its form/container.
    var SUBMIT_TEXT = /submit|send|sign.?up|register|join|subscribe|get|claim|book|reserve|request|apply|confirm|done|إرسال|ارسال|أرسل|سجل|تسجيل|اشترك|احجز|اطلب|تأكيد/i
    function container(btn) {
      if (btn.form) return btn.form
      var f = btn.closest('form')
      if (f) return f
      for (var n = btn.parentElement, i = 0; n && n !== document.body && i < 6; n = n.parentElement, i++) {
        if (n.querySelector('input[type=email], input[type=tel], input[name*=mail i], input[name*=phone i], input[name*=mobile i]')) return n
      }
      return null
    }
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('button, input[type=submit], input[type=button], [role=button], a[href="#"], a:not([href])')
      if (!btn || btn.type === 'reset') return
      var box = container(btn)
      if (!box) return
      var text = (btn.innerText || btn.value || btn.getAttribute('aria-label') || '').trim()
      if (btn.type === 'submit' || SUBMIT_TEXT.test(text)) setTimeout(function () { autoCapture(box) }, 0)
    }, true)
  }

  // ---- dataLayer mirroring ----
  var dlQueue = []
  var dlSeq = parseInt(store('sessionStorage', 'retrgtr_dlseq') || '0', 10)
  var dlSent = 0
  var PERSONAL_KEY = /e.?mail|phone|mobile|msisdn|whats.?app|address|street|postal|zip|birth|dob|user_data|^(name|fname|lname|surname|(first|last|full|given|family|user|customer)[_-]?name)$/i
  function clean(v, depth) {
    if (v === null || typeof v === 'boolean') return v
    if (typeof v === 'number') return isFinite(v) ? v : null
    if (typeof v === 'string') return EMAIL_RE.test(v.trim()) ? '[redacted]' : v.slice(0, 500)
    if (typeof v !== 'object' || depth > 4 || v.nodeType || v === window) return null
    if (Array.isArray(v)) return v.slice(0, 50).map(function (x) { return clean(x, depth + 1) })
    var out = {}
    var n = 0
    for (var k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k) || typeof v[k] === 'function' || n++ >= 100) continue
      out[k] = SENSITIVE.test(k) || PERSONAL_KEY.test(k) ? '[redacted]' : clean(v[k], depth + 1)
    }
    return out
  }
  function record(entry) {
    if (!entry || typeof entry !== 'object' || dlSent + dlQueue.length >= 500) return
    var name = null
    var data = entry
    if (!Array.isArray(entry) && typeof entry.length === 'number' && entry[0] !== undefined) {
      // gtag('event', 'purchase', {...}) pushes an `arguments` object.
      var args = Array.prototype.slice.call(entry)
      name = args[0] === 'event' ? args[1] : 'gtag.' + args[0]
      data = { gtag: args }
    } else name = entry.event || null
    if (typeof name === 'string' && (/^gtm\./.test(name) || /^ooh_/.test(name))) return // GTM internals / our own events
    dlQueue.push({ seq: dlSeq++, ts: Date.now(), event: name ? String(name).slice(0, 120) : null, data: clean(data, 0) })
    store('sessionStorage', 'retrgtr_dlseq', String(dlSeq))
  }
  function flushDataLayer(beacon) {
    while (dlQueue.length && (CAMPAIGN || PARTNER || bid)) {
      var batch = dlQueue.splice(0, 50)
      dlSent += batch.length
      send('/datalayer', { scan_id: ctx.scan_id, visitor_id: visitorId, campaign: CAMPAIGN, partner: PARTNER, consent: { analytics: true }, events: batch }, beacon)
    }
  }
  if (DATALAYER) {
    var dl = (window.dataLayer = window.dataLayer || [])
    for (var i = 0; i < dl.length; i++) record(dl[i])
    var origPush = dl.push
    dl.push = function () {
      for (var j = 0; j < arguments.length; j++) record(arguments[j])
      return origPush.apply(dl, arguments)
    }
    // First flush waits for the scan to be recorded; the API only accepts events for known scans.
    setTimeout(function tick() {
      flushDataLayer(false)
      setTimeout(tick, 5000)
    }, 3000)
    document.addEventListener('visibilitychange', function () { if (document.hidden) flushDataLayer(true) })
    window.addEventListener('pagehide', function () { flushDataLayer(true) })
  }

  window.retrgtr = { capture: capture, readForm: readForm, scanId: ctx.scan_id }
})()
