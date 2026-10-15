# Retrgtr

Consented customer data from OOH (billboard) campaigns, turned into clean customer records and
hashed match lists for retargeting on Meta, Google / YouTube, TikTok and Snapchat. Built for the
Saudi PDPL: nothing is collected before consent, and audiences only ever include people who opted
in to marketing.

## How it works

```
Billboard QR (?bid=…)  →  partner landing page (partner's own web GTM + Retrgtr snippet)
                              │  scans, engagement, dataLayer, form submissions
                              ▼
                     Retrgtr sGTM (one server container for all partners)
                              │  Retrgtr Client: consent gate, forwards IP/UA/origin
                              ▼
                     Retrgtr API (Cloud Run)  ──►  Cloud SQL Postgres  (customers, consents, scans)
                              │                ──►  BigQuery          (pseudonymous raw events)
                              ▼
                     Dashboard (Firebase Hosting): attribution, customers, segments, match-list exports
```

- **One snippet per partner.** Each partner adds a single Custom HTML tag, carrying their partner
  key, to their own GTM. The campaign is resolved from the billboard code (`bid`) in the QR URL,
  otherwise from the partner's active campaign. Data is only accepted from the websites registered
  for that partner on the Partners page.
- **Automatic capture.** The collector (`apps/web/public/retrgtr.js`) loads only after analytics
  consent. It then reads:
  - any submitted form that contains an email or phone. Fields are recognised in English and
    Arabic. Passwords, hidden fields, card numbers and national IDs are never read, and login
    forms are skipped.
  - every dataLayer push, with personal values redacted.
  - device context, repeat exposure and engagement.
- **Consent.** Marketing and ad-personalisation consent come from the form's own checkboxes, or
  from submitting the form when `data-marketing-consent="submit"` is set. Leads without an opt-in
  are stored but never exported or sent to ad platforms.
- **Erasure.** Deleting a customer removes them from Cloud SQL. Their BigQuery events are queued
  and erased by an hourly job, because BigQuery refuses deletes on recently streamed rows.

## Repository layout

| Path | What |
| --- | --- |
| `apps/web` | Dashboard + hosted consent page (`/c/:slug`) + opt-out page. Vite, React, shadcn/ui, Tailwind. |
| `apps/web/public/retrgtr.js` | The collector script partners install through GTM. |
| `apps/api` | Hono API on Node: public collection endpoints, admin endpoints, migrations, tests. |
| `apps/api/migrations` | Postgres schema (applied in order by `npm run migrate`). |
| `config/sgtm/retrgtr-client.tpl` | Server-side GTM Client template (import into the server container). |
| `config/bigquery` | BigQuery table schemas. |
| `config/cloudbuild.api.yaml` | Cloud Build config for the API image. |
| `scripts/` | GCP provisioning and deploy scripts. |

## Local development

Requirements: Node 24, Docker.

```bash
npm install
docker compose up -d db          # Postgres 16 on localhost:5433
npm run migrate
npm run dev:api                  # http://localhost:8787
npm run dev:web                  # http://localhost:5173 (proxies /api to the API)
```

Copy `apps/api/.env.example` to `apps/api/.env` and `apps/web/.env.example` to
`apps/web/.env.local`. `AUTH_DEV_BYPASS=true` (API) and `VITE_AUTH_DEV_BYPASS=true` (web) skip
sign-in locally. The API refuses the bypass in production.

```bash
npm test        # API unit tests (vitest)
npm run build   # type-check and build both apps
```

## Configuration

API (Cloud Run env vars / `apps/api/.env`):

| Variable | Purpose |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Postgres. On Cloud Run `DB_HOST` is `/cloudsql/PROJECT:REGION:INSTANCE`. |
| `ADMIN_ORIGINS` | Dashboard origin(s) allowed to call admin endpoints. Also always allowed to post collector data (the hosted consent page). |
| `ADMIN_EMAILS` | Comma-separated dashboard users (Firebase sign-in, verified email). |
| `FIREBASE_PROJECT_ID` | Firebase project used to verify ID tokens. |
| `SGTM_SHARED_SECRET` | Shared with the sGTM Retrgtr Client; lets the API trust forwarded IP / UA / origin. |
| `BQ_PROJECT_ID`, `BQ_DATASET`, `BQ_LOCATION` | BigQuery event store. Unset `BQ_DATASET` disables streaming (local dev). |
| `DEFAULT_COUNTRY` | Phone parsing default (`SA`). |
| `AUTH_DEV_BYPASS` | Local development only. |

Web (`apps/web/.env.local`, `apps/web/.env.production.local` — not committed):

| Variable | Purpose |
| --- | --- |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` | Firebase web config. |
| `VITE_API_URL` | API base URL (set automatically by `scripts/deploy.sh`). |
| `VITE_COLLECT_URL` | sGTM endpoint, e.g. `https://SGTM-HOST/retrgtr`. When set, the hosted page and the generated snippets send through sGTM. |

## Deploying to GCP

Everything runs in `me-central1` (Doha) by default. `me-central2` (Dammam) needs Google to enable
the region; once it does, run the scripts with `REGION=me-central2`.

1. **Provision once:** Cloud SQL, Artifact Registry, secrets, service account, BigQuery dataset and
   tables, Scheduler API.
   ```bash
   PROJECT_ID=retrgtr ./scripts/gcp-setup.sh
   ```
2. **Firebase:** enable Authentication (Email/Password and Google), create a Web app, and put its
   config in `apps/web/.env.production.local`.
3. **Deploy the app.** This builds the API image, runs migrations as a Cloud Run job, sets up the
   hourly `retrgtr-erasures` job, deploys the API, and builds and deploys the dashboard to
   Firebase Hosting.
   ```bash
   PROJECT_ID=retrgtr ADMIN_EMAILS=you@company.com ./scripts/deploy.sh
   ```
4. **Server-side GTM (one container for all partners).** Create a Server container in Tag
   Manager, choose "Manually provision tagging server", then:
   ```bash
   CONTAINER_CONFIG='…' PROJECT_ID=retrgtr ./scripts/deploy-sgtm.sh
   ```
   In the server container:
   - Set the tagging server URL.
   - Import `config/sgtm/retrgtr-client.tpl` as a Client template.
   - Add a Retrgtr Client with the API URL and the shared secret
     (`gcloud secrets versions access latest --secret retrgtr-sgtm-secret`). Leave allowed
     origins empty, because the API checks each partner's websites.
   - Publish.
   - Set `VITE_COLLECT_URL` and redeploy the dashboard.

The Cloud Run services use `--no-invoker-iam-check` because the organisation's
domain-restricted-sharing policy refuses `allUsers` bindings. Admin endpoints still require a
Firebase ID token from an allow-listed email.

## Onboarding a partner

1. **Partners → New partner.** Add the partner's websites (one per line).
2. **Campaigns → New campaign → Placements.** Add billboards one by one, or use **Import CSV**
   (download the **CSV template** first). Each billboard's code becomes its `bid`. Codes must be
   unique across all campaigns. **All QR codes (.zip)** downloads every print-ready QR plus a
   `manifest.csv` for the print vendor.
3. **Partners → Snippet.** Send the snippet to the partner. They add it in their GTM as a Custom
   HTML tag on All Pages, with Consent Settings requiring `analytics_storage`.
   **If the client already has their own QR codes and landing page**, the snippet still collects
   there. To attribute billboards, set each placement up in one of these ways:
   - **Matching rule.** Their QR URLs already differ per billboard, e.g. `?utm_content=kfr` or
     `/riyadh-offer`. Set "URL parameter = value" or "path starts with". The collector sends the
     landing path and query, with personal-looking keys and values removed, and the API maps the
     visit to the billboard.
   - **Redirect link.** Their QR is dynamic or can be reprinted. Set the client landing page on the
     placement and point the QR at `https://<dashboard>/q/<code>`. It redirects with `bid` + UTMs
     and counts QR opens per billboard. The count is a plain daily number with no IP or cookie.
   - **Neither.** Billboards can't be told apart, so data is attributed to the partner's active
     campaign as a whole.
4. Leads appear under Customers and Attribution. On Attribution, **Credit each lead to** sets how
   leads are counted per billboard:
   - every billboard the person scanned (shared credit);
   - the first billboard;
   - the last billboard before sign-up.

   With first or last, the per-billboard leads add up to the campaign total.
5. Build segments, then export match lists for Meta / Google / TikTok / Snapchat.

## Before going live

- Legal sign-off on the consent wording, the 24-month event retention, and hosting in Doha
  (outside the Kingdom).
- Add every partner's websites; until then their snippet is accepted from any site.
- Optional: ad-platform tags in the sGTM container (use `x-retrgtr-partner` to pick each
  partner's pixel; fire only when `x-retrgtr-ad-personalization` is true), and a first-party
  subdomain for the tagging server.
