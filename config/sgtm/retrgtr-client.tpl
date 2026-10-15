___TERMS_OF_SERVICE___

By creating or modifying this file you agree to Google Tag Manager's Community
Template Gallery Developer Terms of Service available at
https://developers.google.com/tag-manager/gallery-tos (or such other URL as
Google may provide), as modified from time to time.


___INFO___

{
  "type": "CLIENT",
  "id": "cvt_temp_public_id",
  "version": 1,
  "securityGroups": [],
  "displayName": "Retrgtr Client",
  "brand": {
    "id": "brand_dummy",
    "displayName": "Retrgtr"
  },
  "description": "Claims /retrgtr/* requests from the Retrgtr collector, enforces consent, forwards to the Retrgtr API and runs the container with hashed user_data for CAPI / Customer Match tags.",
  "containerContexts": [
    "SERVER"
  ]
}


___TEMPLATE_PARAMETERS___

[
  {
    "type": "TEXT",
    "name": "apiUrl",
    "displayName": "Retrgtr API URL (Cloud Run, no trailing slash)",
    "simpleValueType": true,
    "valueValidators": [{ "type": "NON_EMPTY" }]
  },
  {
    "type": "TEXT",
    "name": "sharedSecret",
    "displayName": "Shared secret (SGTM_SHARED_SECRET on the API)",
    "simpleValueType": true,
    "valueValidators": [{ "type": "NON_EMPTY" }]
  },
  {
    "type": "TEXT",
    "name": "pathPrefix",
    "displayName": "Path prefix",
    "simpleValueType": true,
    "defaultValue": "/retrgtr"
  },
  {
    "type": "TEXT",
    "name": "allowedOrigins",
    "displayName": "Allowed landing-page origins (comma separated, e.g. https://scan.brand.sa)",
    "simpleValueType": true,
    "valueValidators": [{ "type": "NON_EMPTY" }]
  }
]


___SANDBOXED_JS_FOR_SERVER___

// Retrgtr Client — the server-side enforcement point described in the brief:
//  1. Drops any scan without analytics consent and any lead without marketing consent.
//  2. Forwards accepted events to the Retrgtr API (system of record), with the visitor IP/UA.
//  3. Runs the container so GA4 / Meta CAPI / TikTok / Snap / Google Ads tags fire.
//     Leads carry user_data ONLY as SHA-256 hashes, and ONLY with ad-personalisation consent.
//     Gate activation tags on the event data key `x-retrgtr-ad-personalization` = true.

const claimRequest = require('claimRequest');
const getRequestPath = require('getRequestPath');
const getRequestMethod = require('getRequestMethod');
const getRequestBody = require('getRequestBody');
const getRequestHeader = require('getRequestHeader');
const getRemoteAddress = require('getRemoteAddress');
const returnResponse = require('returnResponse');
const setResponseStatus = require('setResponseStatus');
const setResponseHeader = require('setResponseHeader');
const setResponseBody = require('setResponseBody');
const runContainer = require('runContainer');
const sendHttpRequest = require('sendHttpRequest');
const getTimestampMillis = require('getTimestampMillis');
const logToConsole = require('logToConsole');
const JSON = require('JSON');

const prefix = data.pathPrefix || '/retrgtr';
const path = getRequestPath();
if (path.indexOf(prefix + '/') !== 0) return;
claimRequest();

const origin = getRequestHeader('origin');
const allowed = data.allowedOrigins.split(',').map((o) => o.trim());
if (origin && allowed.indexOf(origin) !== -1) {
  setResponseHeader('Access-Control-Allow-Origin', origin);
  setResponseHeader('Vary', 'Origin');
}

const done = (status, body) => {
  setResponseStatus(status);
  if (body) {
    setResponseHeader('Content-Type', 'application/json');
    setResponseBody(body);
  }
  returnResponse();
};

if (getRequestMethod() === 'OPTIONS') {
  setResponseHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  setResponseHeader('Access-Control-Allow-Headers', 'Content-Type');
  setResponseHeader('Access-Control-Max-Age', '86400');
  return done(204);
}
if (getRequestMethod() !== 'POST') return done(405);
if (origin && allowed.indexOf(origin) === -1) return done(403);

const action = path.substring(prefix.length + 1);
if (['scan', 'engagement', 'capture'].indexOf(action) === -1) return done(404);

const raw = getRequestBody();
const body = raw ? JSON.parse(raw) : undefined;
if (!body) return done(400, '{"error":"Invalid JSON"}');

const consent = body.consent || {};
if (action === 'scan' && consent.analytics !== true) {
  logToConsole('retrgtr: dropped scan without analytics consent');
  return done(204);
}
if (action === 'capture' && consent.marketing !== true) {
  logToConsole('retrgtr: dropped lead without marketing consent');
  return done(400, '{"error":"Marketing consent is required"}');
}

const ip = getRemoteAddress();
const ua = getRequestHeader('user-agent') || '';

sendHttpRequest(
  data.apiUrl + '/api/public/' + action,
  {
    method: 'POST',
    timeout: 5000,
    headers: {
      'Content-Type': 'application/json',
      'X-Retrgtr-Key': data.sharedSecret,
      'X-Retrgtr-Client-IP': ip || '',
      'X-Retrgtr-User-Agent': ua,
    },
  },
  raw
).then((res) => {
  const ok = res.statusCode >= 200 && res.statusCode < 300;
  let responseBody = res.body || '';
  if (!ok || action === 'engagement') return done(res.statusCode, responseBody);

  const ctx = body.context || {};
  const event = {
    event_name: action === 'scan' ? 'ooh_scan' : 'generate_lead',
    event_id: (action === 'scan' ? 'scan-' : 'lead-') + (body.scan_id || getTimestampMillis()),
    client_id: body.visitor_id,
    ip_override: ip,
    user_agent: ua,
    page_location: ctx.landing_url,
    page_referrer: ctx.referrer,
    language: ctx.language,
    'x-retrgtr-campaign': body.campaign,
    'x-retrgtr-bid': body.bid,
    'x-retrgtr-offer-variant': body.offer_variant,
    'x-retrgtr-scan-number': body.scan_number,
    'x-retrgtr-ad-personalization': consent.ad_personalization === true,
    utm_source: ctx.utm_source,
    utm_medium: ctx.utm_medium,
    utm_campaign: ctx.utm_campaign,
    fbclid: ctx.fbclid,
    gclid: ctx.gclid,
    ttclid: ctx.ttclid,
    sccid: ctx.sccid,
  };

  if (action === 'capture') {
    const parsed = JSON.parse(responseBody) || {};
    const k = parsed.match_keys;
    if (k && consent.ad_personalization === true) {
      // Hashes only. Raw PII is never placed in event data.
      event.user_data = {
        sha256_email_address: k.em,
        sha256_phone_number: k.ph_e164,
        email_address: k.em,
        phone_number: k.ph_digits,
        address: { sha256_first_name: k.fn, sha256_last_name: k.ln, first_name: k.fn, last_name: k.ln, city: k.ct, country: k.country },
        gender: k.ge,
      };
    }
    // Match keys stay server-side; the browser only learns that it worked.
    responseBody = '{"ok":true}';
  }

  runContainer(event, () => done(res.statusCode, responseBody));
});


___SERVER_PERMISSIONS___

[
  {
    "instance": {
      "key": { "publicId": "read_request", "versionId": "1" },
      "param": [
        { "key": "requestAccess", "value": { "type": 1, "string": "any" } },
        { "key": "headerAccess", "value": { "type": 1, "string": "any" } },
        { "key": "queryParameterAccess", "value": { "type": 1, "string": "any" } }
      ]
    },
    "clientAnnotations": { "isEditedByUser": true },
    "isRequired": true
  },
  {
    "instance": {
      "key": { "publicId": "return_response", "versionId": "1" },
      "param": []
    },
    "isRequired": true
  },
  {
    "instance": {
      "key": { "publicId": "access_response", "versionId": "1" },
      "param": [
        { "key": "writeResponseAccess", "value": { "type": 1, "string": "any" } },
        { "key": "writeHeaderAccess", "value": { "type": 1, "string": "any" } }
      ]
    },
    "clientAnnotations": { "isEditedByUser": true },
    "isRequired": true
  },
  {
    "instance": {
      "key": { "publicId": "run_container", "versionId": "1" },
      "param": []
    },
    "isRequired": true
  },
  {
    "instance": {
      "key": { "publicId": "send_http", "versionId": "1" },
      "param": [
        { "key": "allowedUrls", "value": { "type": 1, "string": "any" } }
      ]
    },
    "clientAnnotations": { "isEditedByUser": true },
    "isRequired": true
  },
  {
    "instance": {
      "key": { "publicId": "logging", "versionId": "1" },
      "param": [
        { "key": "environments", "value": { "type": 1, "string": "debug" } }
      ]
    },
    "clientAnnotations": { "isEditedByUser": true },
    "isRequired": true
  }
]


___TESTS___

scenarios: []


___NOTES___

Import: sGTM container → Templates → Client Templates → New → ⋮ → Import.
If import rejects the permissions block, create a blank Client template instead,
paste the SANDBOXED_JS section into the Code tab and the parameters above —
GTM derives the permissions from the require() calls; set each to "any".
