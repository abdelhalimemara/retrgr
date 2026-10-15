# OOH Retargeting & Enrichment Platform — Implementation Brief

**Product:** QR-driven OOH attribution + audience activation
**Stack:** Client GTM → Server-side GTM → GA4 / BigQuery / ad platforms
**Jurisdiction:** KSA (PDPL). Not legal advice — have counsel sign off on the consent copy and data-retention policy before launch.

---

## 1. What this system actually does

A viewer scans a QR on a billboard → lands on a page you control → you (a) make them retargetable the instant the page loads, (b) capture identity + self-declared demographics if they fill the form, (c) attach rich device/context/behavior data, and (d) consolidate it all into a per-customer profile keyed on a hashed identifier.

**Hard boundary — read once, never revisit:**
The browser exposes device, context, and behavior **on your own page only**. It does **not** expose age, gender, interests, or where the user browses afterward. Those come from (a) your form (self-declared, per-user) or (b) Google Signals / platform audience insights (aggregated, never per-user). No custom script changes this. Everything below is built inside that boundary.

---

## 2. Architecture

```
          Billboard QR (unique per placement)
                        │
                        ▼
          Landing page (your domain / white-label subdomain)
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                 ▼
  Consent banner   Context script    Behavior script
  (Consent Mode)   (device/UA/geo)   (engagement)
        │               │                 │
        └───────────────┴────────┬────────┘
                                 ▼
                         Client GTM (dataLayer)
                                 ▼
                     Server-side GTM container
                                 │
     ┌──────────┬──────────┬─────────┬──────────┬─────────┐
     ▼          ▼          ▼         ▼          ▼         ▼
   GA4      Meta CAPI   TikTok    Snap CAPI  Google    BigQuery
 (devices,  (hashed)    Events    (hashed)   Ads CM    (raw store
  context)              API                            + join)
```

**Why server-side is non-negotiable here:**
1. Raw hashes and PII never ship to ad platforms from the client.
2. `event_id` dedupe across client pixel + server event.
3. Recovers signal iOS/Safari and ad blockers strip from client-side tags.
4. Single enforcement point to **drop any event where marketing consent = false** — your PDPL audit trail.

---

## 3. Per-customer data model

Primary key: `user_id` = SHA-256 of normalized email (fallback: hashed phone). This is the join key across every source.

| Field | Source | Notes |
|---|---|---|
| `user_id` | Form (hashed) | Email → trim → lowercase → SHA-256 |
| `ph_hash` | Form (hashed) | Phone → E.164 → SHA-256 |
| `first_scan_ts` | Context script | First exposure |
| `billboard_ids[]` | Context script | **Array** — captures multi-placement exposure |
| `scan_count` | localStorage counter | Repeat-exposure signal |
| `campaign_flights[]` | UTM | Which flights touched this person |
| `device_type / os / browser` | UA Client Hints | |
| `device_model` | High-entropy UA hint | e.g. iPhone15,3 |
| `screen / viewport / dpr` | Context script | |
| `language / timezone` | Context script | AR vs EN = targeting signal |
| `connection_type` | `navigator.connection` | |
| `carrier` | Server-side (IP→ASN) | STC / Mobily / Zain KSA |
| `city / district` | GA4 geo + server reverse | |
| `age_range` | **Form, self-declared** | Only per-user age you'll ever have |
| `gender` | **Form, self-declared** | Optional field |
| `interests[]` | Form (optional) or on-page behavior | |
| `engagement_score` | Behavior script | Scroll + dwell + CTA |
| `offer_variant` | A/B assignment | Which creative/offer converted |
| `consent_marketing` | Consent banner | Gates all activation |
| `consent_ts` | Consent banner | Audit |
| `platform_match_status` | Post-upload | Matched on Meta/TikTok/etc. |

Store aggregated demographic reads (Google Signals age/gender skews) **at the `billboard_id` level, not the user level** — a separate table, because that's the granularity Google permits.

---

## 4. GTM scripts

### 4.1 Context capture (Custom HTML tag)
Fires **on consent granted**, not page load.

```html
<script>
(function () {
  function collect() {
    var nav = navigator, uaData = nav.userAgentData || {};
    var conn = nav.connection || {}, scr = window.screen || {};
    var params = new URLSearchParams(window.location.search);
    var hints = window.__uaHints || {};

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: 'ooh_scan_context',

      // placement attribution
      billboard_id: params.get('bid') || null,
      campaign_flight: params.get('flight') || null,
      utm_source: params.get('utm_source') || null,
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
      offer_variant: params.get('v') || null,

      // device + browser
      ua_platform: uaData.platform || null,
      ua_platform_version: hints.platformVersion || null,
      ua_mobile: (typeof uaData.mobile === 'boolean') ? uaData.mobile : null,
      device_model: hints.model || null,
      browser_brands: uaData.brands ? uaData.brands.map(function(b){return b.brand+' '+b.version;}).join(', ') : null,
      user_agent: nav.userAgent || null,

      // screen
      screen_w: scr.width || null, screen_h: scr.height || null,
      viewport_w: window.innerWidth || null, viewport_h: window.innerHeight || null,
      pixel_ratio: window.devicePixelRatio || null,
      orientation: (scr.orientation && scr.orientation.type) || null,

      // context
      language: nav.language || null,
      languages: nav.languages ? nav.languages.join(',') : null,
      timezone: (Intl && Intl.DateTimeFormat().resolvedOptions().timeZone) || null,
      connection_type: conn.effectiveType || null,
      hardware_concurrency: nav.hardwareConcurrency || null,
      device_memory: nav.deviceMemory || null,
      touch_points: nav.maxTouchPoints || 0,

      referrer: document.referrer || null,
      page_url: window.location.href,
      scan_ts: new Date().toISOString()
    });
  }

  // High-entropy UA hints are async — resolve first, then push
  if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
    navigator.userAgentData.getHighEntropyValues(
      ['platform','platformVersion','model','uaFullVersion','architecture']
    ).then(function (h) { window.__uaHints = h; collect(); }).catch(collect);
  } else { collect(); }
})();
</script>
```

### 4.2 Identity join (on form submit)
Hash in-browser so raw PII never leaves the device.

```html
<script>
async function sha256(str){
  var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str).trim().toLowerCase()));
  return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
}
async function onLeadSubmit(form){
  var phone = form.phone.value.replace(/[^\d+]/g,''); // normalize to E.164 before hashing
  window.dataLayer.push({
    event: 'ooh_lead_submit',
    user_id: await sha256(form.email.value),
    ph_hash: await sha256(phone),
    age_range: form.age_range.value || null,   // self-declared
    gender: form.gender.value || null,          // self-declared, optional
    interests: form.interests ? form.interests.value || null : null,
    consent_marketing: !!form.consent.checked
  });
}
</script>
```

### 4.5 Generic form-field capture (any form, any field)
Grabs **every** field on submit without hardcoding names — works across all your landing-page forms. The classification map is the safety layer: PII gets hashed, sensitive fields are dropped entirely, everything else passes as a plain value. Never "capture all" blind — that's a PDPL liability.

```html
<script>
(function(){
  // ---- field classification (edit per form family) ----
  var HASH   = ['email','e-mail','mail','phone','mobile','tel','whatsapp']; // PII → SHA-256
  var DENY   = ['national_id','nid','iqama','passport','ssn','card','cvv','iban']; // never capture
  var CONSENT_FIELD = 'consent'; // name of your marketing-consent checkbox

  function classify(name){
    name = (name||'').toLowerCase();
    if (DENY.some(function(k){return name.indexOf(k)>-1;})) return 'deny';
    if (HASH.some(function(k){return name.indexOf(k)>-1;})) return 'hash';
    return 'plain';
  }
  async function sha256(str){
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str).trim().toLowerCase()));
    return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
  }
  function normalize(name, val){
    return name.toLowerCase().match(/phone|mobile|tel|whatsapp/) ? val.replace(/[^\d+]/g,'') : val;
  }

  async function captureForm(form){
    var out = { event:'ooh_form_submit', form_id: form.id || form.getAttribute('name') || 'unknown', fields:{} };
    var hashed = {};
    var els = form.querySelectorAll('input, select, textarea');

    for (var i=0;i<els.length;i++){
      var el = els[i];
      var name = el.name || el.id;
      if (!name || el.type==='hidden' && !el.value) continue;
      if (el.type==='password') continue; // never

      // value by field type
      var val;
      if (el.type==='checkbox') val = el.checked;
      else if (el.type==='radio'){ if(!el.checked) continue; val = el.value; }
      else val = el.value;
      if (val==='' || val==null) continue;

      var kind = classify(name);
      if (kind==='deny') continue;                               // dropped — never leaves the page
      if (kind==='hash'){ hashed[name] = await sha256(normalize(name, val)); }
      else { out.fields[name] = val; }                           // plain, non-PII
    }

    // promote the standard match keys to known slots for downstream mapping
    for (var k in hashed){
      if (/email|mail/.test(k)) out.user_id = hashed[k];
      else if (/phone|mobile|tel|whatsapp/.test(k)) out.ph_hash = hashed[k];
      out.fields[k+'_hash'] = hashed[k];
    }

    out.consent_marketing = !!(form.elements[CONSENT_FIELD] && form.elements[CONSENT_FIELD].checked);
    out.consent_ts = new Date().toISOString();

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(out);
  }

  // bind to every form on the page (delegated, survives dynamic forms)
  document.addEventListener('submit', function(e){
    if (e.target && e.target.tagName==='FORM') captureForm(e.target);
  }, true);
})();
</script>
```

**How it behaves:**
- **Every field** on any form is captured on submit — no per-field wiring. Add a new form field and it flows through automatically.
- `email`/`phone`-type names → **hashed** (`user_id`, `ph_hash`) so raw PII never leaves the browser.
- Anything matching the `DENY` list (national ID, iqama, passport, card, IBAN…) → **silently dropped**, never pushed. This is the field that keeps you compliant.
- Everything else (age range, gender, interests, free-text, preferences) → passed as a plain value under `fields{}`.
- Consent checkbox is read and stamped on every submit.

**GTM wiring:** one Custom HTML tag, fires on consent-granted (or DOM ready if the forms themselves gate behind consent). Then a Data Layer variable per field you want to route — `fields.age_range`, `fields.gender`, `user_id`, etc. — mapped into your GA4 event params and server-side container.

**Two cautions:**
1. **Review the `DENY` list against your actual form fields before launch.** If a form ever asks for anything in a sensitive category, add its field name here first. Default to denying when unsure.
2. **Don't capture free-text fields that could hold sensitive content** (e.g. an open "message" box where users might type health or ID info). Either exclude by name or truncate.

### 4.3 Behavior / engagement (Custom HTML tag)
This is pure first-party behavior on your page — legitimate, high-value, and GA4 doesn't give it to you this cleanly.

```html
<script>
(function(){
  var start = Date.now(), maxScroll = 0, ctaClicks = 0;
  window.addEventListener('scroll', function(){
    var p = Math.round((window.scrollY + window.innerHeight) / document.body.scrollHeight * 100);
    if (p > maxScroll) maxScroll = Math.min(p, 100);
  }, { passive:true });
  document.addEventListener('click', function(e){
    if (e.target.closest('[data-cta]')) ctaClicks++;
  });
  function flush(){
    window.dataLayer.push({
      event: 'ooh_engagement',
      dwell_seconds: Math.round((Date.now()-start)/1000),
      max_scroll_pct: maxScroll,
      cta_clicks: ctaClicks,
      scan_to_action_ms: window.__firstActionTs ? (window.__firstActionTs - start) : null
    });
  }
  document.addEventListener('visibilitychange', function(){ if(document.hidden) flush(); });
  window.addEventListener('pagehide', flush);
})();
</script>
```

### 4.4 Repeat-exposure counter (fires before context script)
```html
<script>
(function(){
  try {
    var n = parseInt(localStorage.getItem('ooh_scan_count')||'0',10)+1;
    localStorage.setItem('ooh_scan_count', n);
    var bids = JSON.parse(localStorage.getItem('ooh_bids')||'[]');
    var bid = new URLSearchParams(location.search).get('bid');
    if (bid && bids.indexOf(bid)===-1) bids.push(bid);
    localStorage.setItem('ooh_bids', JSON.stringify(bids));
    window.__ooh = { scan_count: n, prior_bids: bids };
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event:'ooh_return', scan_count:n, prior_billboards:bids.join(',') });
  } catch(e){}
})();
</script>
```

---

## 5. Enrichment catalog — what else GTM can legitimately add

Grouped by where the work happens. Everything in Tier 1–2 is first-party and consent-gated. Tier 4 is the "don't" list.

### Tier 1 — Client-side, free signal (do all of these)
| Signal | How | Why it's worth it |
|---|---|---|
| **Scan-to-action latency** | `ooh_engagement` | Measures creative pull — fast form fills = strong billboard |
| **Multi-billboard exposure** | localStorage array | Frequency/sequence across placements = sequential retargeting |
| **Return-scanner detection** | localStorage counter | Separates fresh reach from repeat exposure |
| **Daypart of scan** | `scan_ts` + timezone | Validates billboard dayparting; feeds ad scheduling |
| **Language preference** | `navigator.language` | AR/EN split drives creative + audience split |
| **Offer/creative variant** | UTM `?v=` | Which offer converts which device/demo cohort |
| **Field-level form drop-off** | focus/blur events per field | Fix the field killing conversion |
| **Orientation + device model** | UA hints | QC the landing page per device; model = rough value proxy |

### Tier 2 — Server-side enrichment (highest ROI, no consent friction)
Done in the server container from the inbound request — the client never sees it, no extra permission prompts.
| Signal | How | Value |
|---|---|---|
| **Carrier / ASN** | IP → ASN lookup | STC / Mobily / Zain segmentation |
| **District-level geo** | IP → reverse geo | Finer than GA4 city; ties scans to billboard catchment |
| **IP → connection class** | ASN type | Residential vs mobile vs corporate |
| **Weather at scan** | City + timestamp → weather API | OOH × weather correlation — strong story for media owners |
| **Bot/fraud filter** | IP reputation + UA sanity | Strip scraper/bot scans before they pollute audiences |
| **Event dedup ID** | Generate `event_id` server-side | Clean match between client pixel & CAPI |

### Tier 3 — Modeled / aggregated (report layer, not per-user)
| Signal | Source | Granularity |
|---|---|---|
| Age / gender skew | GA4 + Google Signals | Per `billboard_id`, thresholded |
| Interest / in-market | GA4 + Google Signals | Aggregated |
| Audience insights | Meta/TikTok/Snap on your custom audiences | Aggregated per list |
| Lookalike seeds | Platform, from scanner lists | For prospecting |

### Tier 4 — Do NOT build (PDPL + platform + technical risk)
- ❌ Cross-site browsing tracking after they leave your page — **impossible** without spyware, illegal with it.
- ❌ National ID collection for targeting — fails data minimization.
- ❌ Precise GPS prompt — kills conversion, aggregated geo is enough.
- ❌ Canvas/WebGL fingerprinting — ad-blocker flagged, privacy-hostile.
- ❌ Appending third-party data brokers to identity — PDPL consent can't cover it.

---

## 6. Consent layer (PDPL spine)

1. **Consent Mode v2** in GTM. Banner sets `ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization`.
2. No marketing/activation tag fires until **marketing consent = granted**. Context + behavior scripts gate on it.
3. Consent state (`consent_marketing`, `consent_ts`, consent copy version) rides on **every** dataLayer push.
4. Server container **drops any activation event where `consent_marketing` is false** — hard rule, logged.
5. Separate the purposes on the banner: analytics vs ad personalization vs matching. Granular consent = defensible.
6. Retention policy on the profile store (e.g. 12–24 months), with a deletion path. Decide and document before launch.

---

## 7. BigQuery join

Three tables, one join key (`user_id`):
- **`scans_context`** — one row per scan (device, context, billboard, consent).
- **`leads`** — one row per form submit (hashed identity, self-declared demo).
- **`engagement`** — one row per session (dwell, scroll, CTA).
- **`billboard_demographics`** — aggregated Google Signals reads, keyed on `billboard_id` (NOT joined to users).

Consolidated profile = `leads` LEFT JOIN `scans_context` LEFT JOIN `engagement` on `user_id`, collapsing `billboard_ids` and `campaign_flights` into arrays. Feed GA4's BigQuery export in for the device/session fields GA4 captures better than a custom script.

---

## 8. Activation

| Platform | Method | Input |
|---|---|---|
| Meta | Custom Audience via CAPI | `user_id` (email hash), `ph_hash` |
| TikTok | Events API + Customer File | Hashed email/phone |
| Snap | CAPI + Customer List | Hashed email/phone |
| Google Ads | Customer Match | Hashed email/phone |

Expect ~40–70% match rates on MENA lists. Seed lookalikes from matched scanners. Measure **lift: retargeted scanners vs holdout scanners** — that's the number that renews the contract.

---

## 9. Build phasing

**Phase 1 — Attribution (ship first):**
Unique QR per placement, landing page, Consent Mode banner, GA4 + context script, placement-level dashboards (scans, cost/scan, device split, daypart).

**Phase 2 — Activation:**
Server-side GTM, pixel-on-load scan audiences, Customer Match uploads, CAPI event flow.

**Phase 3 — Enrichment & profile:**
Behavior script, server-side enrichment (carrier, geo, weather), BigQuery join, per-customer profile, lookalikes, lift measurement.

**Phase 4 — Product layer:**
Self-serve dashboard for media owners/agencies: scan heatmaps, cost per scan/lead per billboard, demographic skews per placement, lift reports.

---

## 10. The positioning reminder

Sell this as **OOH attribution + audience activation**, not "browsing data." The attribution layer (which billboard drove which scan, lead, and conversion) is the gap OOH buyers can't close today, it survives enterprise compliance review, and it's what makes media owners and agencies buy. The enrichment makes the audiences sharper; the attribution makes the product sellable.
