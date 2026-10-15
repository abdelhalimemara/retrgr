/*!
 * Retrgtr collector — one snippet per partner, as a Custom HTML tag in the partner's GTM (GTM drops
 * data- attributes, so settings come from window.retrgtrConfig or the script URL's query string):
 *   <script>window.retrgtrConfig = { endpoint: 'https://SGTM', path: '/retrgtr', partner: 'KEY' }</script>
 *   <script src="https://DASHBOARD/retrgtr.js?partner=KEY" async></script>
 * Options: policyVersion, consent ('notice'), campaign, forms ('off'), datalayer ('off'). Unsubmitted
 * form values are never read; personal data only goes to the endpoint. Docs: README + Collector setup.
 */
(function () {
  'use strict'
  if (window.retrgtr) return
  var s = document.currentScript || document.querySelector('script[src*="retrgtr.js"]')
  var cfg = window.retrgtrConfig || {}
  var qp = {}
  try { new URL(s.src).searchParams.forEach(function (v, k) { qp[k] = v }) } catch (e) {}
  // data-foo-bar attribute → ?foo-bar= on the script URL → retrgtrConfig.fooBar
  var attr = function (n, d) {
    var k = n.replace(/^data-/, '')
    var v = s && s.getAttribute(n)
    if (v == null) v = qp[k] != null ? qp[k] : cfg[k.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase() })]
    return v == null || v === '' ? d : String(v)
  }
  var pa = s && s.getAttribute('data-path') // '' is meaningful: endpoint already includes the path
  var pathAttr = pa != null ? pa : qp.path != null ? qp.path : cfg.path != null ? String(cfg.path) : null
  // No endpoint configured → the collector's own origin, where Hosting forwards /retrgtr to the central sGTM.
  var origin = ''
  try { origin = new URL(s.src).origin } catch (e) {}
  var ENDPOINT = attr('data-endpoint', origin).replace(/\/$/, '') + (pathAttr == null ? '/retrgtr' : pathAttr)
  var CAMPAIGN = attr('data-campaign', '') || null
  var PARTNER = attr('data-partner', '') || null
  var POLICY = attr('data-policy-version', 'v1')
  var URL_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid', 'sccid']
  var FORM_FIELDS = ['email', 'phone', 'first_name', 'last_name', 'age_range', 'gender', 'city']
  var BASIS = attr('data-consent', 'banner') === 'notice' ? 'notice' : 'consent'
  // Latest Consent Mode state for a type, read from gtag('consent', 'default'|'update', …) pushes.
  function consentState(type, updatesOnly) {
    var state = null
    ;(window.dataLayer || []).forEach(function (e) {
      if (e && e[0] === 'consent' && (e[1] === 'update' || (!updatesOnly && e[1] === 'default')) && e[2] && e[2][type]) state = e[2][type]
    })
    return state
  }
  // Notice mode never overrides a visitor who actively declined analytics in a consent banner.
  if (BASIS === 'notice' && consentState('analytics_storage', true) === 'denied') return
  var AUTO_FORMS = attr('data-forms', 'auto') !== 'off', DATALAYER = attr('data-datalayer', 'on') !== 'off'
  var CTX_KEY = 'retrgtr_ctx'

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = crypto.getRandomValues(new Uint8Array(1))[0] & 15; return (c === 'x' ? r : (r & 3) | 8).toString(16)
    })
  }
  function store(kind, key, val) {
    try { if (val === undefined) return window[kind].getItem(key); window[kind].setItem(key, val) } catch (e) {}
    return null
  }
  function push(data) { (window.dataLayer = window.dataLayer || []).push(data) }
  function send(path, body, beacon) {
    var json = JSON.stringify(body)
    if (beacon && navigator.sendBeacon) return navigator.sendBeacon(ENDPOINT + path, json)
    return fetch(ENDPOINT + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true })
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
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone } catch (e) {}
    var c = { device_type: deviceType(), language: navigator.language || null, timezone: tz }
    URL_PARAMS.concat(['landing_url', 'referrer']).forEach(function (k) { if (ctx[k]) c[k] = ctx[k] })
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
      network: conn.type || null, // wifi / cellular where the browser exposes it
      languages: navigator.languages ? navigator.languages.join(',').slice(0, 200) : null,
      touch_points: navigator.maxTouchPoints || 0,
    }
  }

  // ---- landing page path + query, for client-owned QR codes without a bid ----
  // Matched server-side against the billboard rules (e.g. utm_content=kfr, path /riyadh-offer).
  // Personal-looking keys/values and click IDs are never sent.
  function landingPage() {
    var skip = /mail|phone|mobile|(^|_)tel($|_)|(^|_)(first|last|full|user)?_?name$|address|token|pass|secret|^code$|otp|session|^(fbclid|gclid|ttclid|sccid|msclkid|_ga|_gl)$/i
    var q = {}
    var n = 0
    qs.forEach(function (v, k) {
      if (n >= 30 || skip.test(k) || k.length > 64 || !v) return
      if (/@/.test(v) || v.replace(/\D/g, '').length >= 9) return
      q[k] = v.slice(0, 200)
      n++
    })
    return { path: location.pathname.slice(0, 300), query: q }
  }

  // ---- scan (once per session) ----
  // Settles once the scan is recorded, so a fast lead can be linked to its billboard.
  var scanResolve
  var scanDone = new Promise(function (r) { scanResolve = r })
  function sendScan(hints) {
    var req = send('/scan', {
      scan_id: ctx.scan_id,
      visitor_id: visitorId,
      campaign: CAMPAIGN,
      partner: PARTNER,
      bid: bid,
      offer_variant: variant,
      scan_number: Math.max(scanNumber, 1),
      prior_bids: priorBids.filter(function (b) { return b !== bid }),
      consent: { analytics: true, basis: BASIS, policy_version: POLICY },
      context: context(),
      page: bid ? null : landingPage(),
      device: device(hints || {}),
    })
    // A client-QR rule matched → the API returns the billboard code; keep it for this session.
    Promise.resolve(req)
      .then(function (res) {
        if (!res || !res.ok || !/json/.test(res.headers.get('content-type') || '')) return
        return res.json().then(function (j) {
          if (!j) return
          if (j.save_typed) ctx.save_typed = true // partner's form discloses "saved as you type"
          if (j.bid && !bid) bid = ctx.bid = String(j.bid)
          store('sessionStorage', CTX_KEY, JSON.stringify(ctx))
          if (!bid) return
          if (priorBids.indexOf(bid) === -1) store('localStorage', 'retrgtr_bids', JSON.stringify(priorBids.concat(bid).slice(-50)))
        })
      })
      .then(scanResolve, scanResolve)
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
  var maxScroll = 0, ctaClicks = 0, firstActionTs = null
  var formStarted = false, formSubmitted = false
  var lastField = null
  function action() { if (!firstActionTs) firstActionTs = Date.now() }
  window.addEventListener('scroll', function () {
    var h = document.documentElement.scrollHeight || document.body.scrollHeight
    var p = Math.round(((window.scrollY + window.innerHeight) / h) * 100)
    if (p > maxScroll) maxScroll = Math.min(p, 100)
  }, { passive: true })
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-cta]')) {
      ctaClicks++
      action()
    }
  })
  // ---- form analytics: how far people get and where they stop — field NAMES only ----
  // Typed values of forms that are never submitted are not read or sent.
  var formStats = {}
  var TRACK_SKIP = /^(password|hidden|file|submit|button|reset|image)$/
  function fieldName(el) { return String(el.name || el.id || '').slice(0, 40) }
  function formKey(f) { return (f.id || f.getAttribute('name') || (f.getAttribute('action') || '').split('?')[0] || 'form').slice(0, 120) }
  function trackable(el) { return el && el.form && !el.form.closest('[data-retrgtr-ignore]') && fieldName(el) && !TRACK_SKIP.test((el.type || '').toLowerCase()) }
  function statFor(f) {
    var k = formKey(f)
    if (!formStats[k]) {
      var total = 0
      Array.prototype.forEach.call(f.elements, function (el) {
        if (trackable(el) && (el.type !== 'radio' || el === f.elements[el.name][0])) total++
      })
      formStats[k] = { form_id: k, fields_total: total, filled: {}, last_field: null, submitted: false, reported: false }
    }
    return formStats[k]
  }
  document.addEventListener('focusin', function (e) {
    if (!trackable(e.target)) return
    var st = statFor(e.target.form)
    formStarted = true
    lastField = st.last_field = fieldName(e.target)
    action()
  })
  // Record only WHETHER a field has a value when the visitor moves on — never the value.
  function noteFilled(e) {
    var el = e.target
    if (!trackable(el)) return
    var has = el.type === 'checkbox' || el.type === 'radio' ? el.checked : !!(el.value && String(el.value).trim())
    var st = statFor(el.form)
    if (has) st.filled[fieldName(el)] = true
    else if (el.type !== 'radio') delete st.filled[fieldName(el)]
    if (ctx.save_typed) savePartial(el.form)
  }
  // Disclosed "save as you type" only (partner setting + notice on their form, enforced server-side):
  // the form's current entries, read like a submit (no passwords/IDs), once it has an email or phone.
  var partialTimer
  function savePartial(form) {
    clearTimeout(partialTimer)
    partialTimer = setTimeout(function () {
      var f = readForm(form)
      if (f && !statFor(form).submitted) send('/engagement', { scan_id: ctx.scan_id, dwell_seconds: Math.round((Date.now() - start) / 1000), max_scroll_pct: maxScroll, cta_clicks: ctaClicks, partial: f }, true)
    }, 1200)
  }
  document.addEventListener('focusout', noteFilled)
  document.addEventListener('change', noteFilled)
  function markSubmitted(f) {
    if (f && f.tagName === 'FORM') statFor(f).submitted = true
  }
  var flushed = 0
  function flush() {
    var dwell = Math.round((Date.now() - start) / 1000)
    if (dwell === flushed) return
    flushed = dwell
    var body = {
      scan_id: ctx.scan_id, visitor_id: visitorId, dwell_seconds: Math.min(dwell, 86400), max_scroll_pct: maxScroll,
      cta_clicks: ctaClicks, scan_to_action_ms: firstActionTs ? firstActionTs - start : null,
      form_started: formStarted, form_submitted: formSubmitted, last_field: formSubmitted ? null : lastField,
      forms: [], abandon_event: false, ad_storage_granted: consentState('ad_storage') === 'granted',
    }
    Object.keys(formStats).slice(0, 10).forEach(function (k) {
      var st = formStats[k]
      var filled = Object.keys(st.filled).slice(0, 100)
      body.forms.push({ form_id: st.form_id, fields_total: st.fields_total, fields_filled: filled, last_field: st.last_field, submitted: st.submitted })
      if (!st.submitted && !st.reported) {
        // Once per form per page view: lets the partner's web tags (and sGTM) retarget abandoners
        // by cookie/pixel — no form data involved.
        st.reported = true
        body.abandon_event = true
        push({ event: 'ooh_form_abandon', ooh_form_id: st.form_id, ooh_last_field: st.last_field, ooh_fields_filled: filled.length, ooh_bid: bid })
      }
    })
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
    FORM_FIELDS.forEach(function (k) { body[k] = fields[k] || null })
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
    var f = { source: 'auto', extra: {}, consent_marketing: false, consent_ad_personalization: false }
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
    markSubmitted(form)
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
      // A form the browser itself refuses (required/invalid fields) is not submitted — don't read it.
      if (box.tagName === 'FORM' && box.checkValidity && !box.checkValidity()) return
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
    while (dlQueue.length) {
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
    // First flush only after the scan is recorded: the API drops events for scans it doesn't know yet.
    scanDone.then(function tick() { flushDataLayer(false); setTimeout(tick, 5000) })
    document.addEventListener('visibilitychange', function () { if (document.hidden) flushDataLayer(true) })
    window.addEventListener('pagehide', function () { flushDataLayer(true) })
  }

  window.retrgtr = { capture: capture, readForm: readForm, scanId: ctx.scan_id }
})()
