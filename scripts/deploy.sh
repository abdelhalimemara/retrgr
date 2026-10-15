#!/usr/bin/env bash
# Builds and deploys the Retrgtr API (Cloud Run + migration job) and dashboard (Firebase Hosting).
#
#   PROJECT_ID=my-project ADMIN_EMAILS=a@x.com,b@x.com ./scripts/deploy.sh
#
# Optional: WEB_ORIGIN (dashboard URL, defaults to https://$PROJECT_ID.web.app),
#           SKIP_WEB=1 to deploy only the API.
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
: "${ADMIN_EMAILS:?Set ADMIN_EMAILS (comma-separated dashboard users)}"
REGION="${REGION:-me-central1}"
SQL_INSTANCE="${SQL_INSTANCE:-retrgtr-db}"
BQ_DATASET="${BQ_DATASET:-retrgtr_events}"
AR_REPO="${AR_REPO:-retrgtr}"
SERVICE="retrgtr-api"
SA="retrgtr-api@${PROJECT_ID}.iam.gserviceaccount.com"
WEB_ORIGIN="${WEB_ORIGIN:-https://${PROJECT_ID}.web.app}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="$(date +%Y%m%d-%H%M%S)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/api:${TAG}"
CONN="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"

gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Building API image ($IMAGE)"
# Cloud Build runs globally; the image is stored in Artifact Registry in $REGION. No PII is involved.
gcloud builds submit "$ROOT" --config "$ROOT/config/cloudbuild.api.yaml" \
  --substitutions "_IMAGE=$IMAGE"

COMMON_ENV="NODE_ENV=production,DB_HOST=/cloudsql/${CONN},DB_NAME=retrgtr,DB_USER=retrgtr"
SECRETS="DB_PASSWORD=retrgtr-db-password:latest,SGTM_SHARED_SECRET=retrgtr-sgtm-secret:latest"

echo "==> Running migrations (Cloud Run job)"
JOB_ARGS=(--image "$IMAGE" --region "$REGION" --service-account "$SA" --set-cloudsql-instances "$CONN"
  --set-env-vars "$COMMON_ENV" --set-secrets "$SECRETS" --command node --args dist/scripts/migrate.js
  --max-retries 0 --task-timeout 300)
if gcloud run jobs describe retrgtr-migrate --region "$REGION" >/dev/null 2>&1; then
  gcloud run jobs update retrgtr-migrate "${JOB_ARGS[@]}"
else
  gcloud run jobs create retrgtr-migrate "${JOB_ARGS[@]}"
fi
gcloud run jobs execute retrgtr-migrate --region "$REGION" --wait

echo "==> BigQuery erasure retry job (hourly)"
# Erasures BigQuery refuses while rows sit in the streaming buffer are queued and retried here.
ERASE_ARGS=(--image "$IMAGE" --region "$REGION" --service-account "$SA" --set-cloudsql-instances "$CONN"
  --set-env-vars "${COMMON_ENV},BQ_PROJECT_ID=${PROJECT_ID},BQ_DATASET=${BQ_DATASET},BQ_LOCATION=${REGION}"
  --set-secrets "$SECRETS" --command node --args dist/scripts/flush-erasures.js --max-retries 0 --task-timeout 600)
if gcloud run jobs describe retrgtr-erasures --region "$REGION" >/dev/null 2>&1; then
  gcloud run jobs update retrgtr-erasures "${ERASE_ARGS[@]}"
else
  gcloud run jobs create retrgtr-erasures "${ERASE_ARGS[@]}"
fi
gcloud run jobs add-iam-policy-binding retrgtr-erasures --region "$REGION" \
  --member "serviceAccount:$SA" --role roles/run.invoker >/dev/null
SCHED_ARGS=(--location "$REGION" --schedule "15 * * * *" --http-method POST
  --uri "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/retrgtr-erasures:run"
  --oauth-service-account-email "$SA")
if gcloud scheduler jobs describe retrgtr-erasures --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http retrgtr-erasures "${SCHED_ARGS[@]}"
else
  gcloud scheduler jobs create http retrgtr-erasures "${SCHED_ARGS[@]}"
fi

echo "==> Deploying API service"
# --no-invoker-iam-check makes the service public without an allUsers binding, which
# domain-restricted-sharing org policies refuse. Admin routes still verify Firebase tokens.
gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" --service-account "$SA" \
  --add-cloudsql-instances "$CONN" --no-invoker-iam-check \
  --set-env-vars "^;^${COMMON_ENV//,/;};ADMIN_ORIGINS=${WEB_ORIGIN};ADMIN_EMAILS=${ADMIN_EMAILS};FIREBASE_PROJECT_ID=${PROJECT_ID};BQ_PROJECT_ID=${PROJECT_ID};BQ_DATASET=${BQ_DATASET};BQ_LOCATION=${REGION}" \
  --set-secrets "$SECRETS" \
  --min-instances 0 --max-instances 20 --cpu 1 --memory 512Mi --concurrency 80
API_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"
echo "    API: $API_URL"

if [[ "${SKIP_WEB:-}" == "1" ]]; then exit 0; fi

echo "==> Building dashboard"
ENV_FILE="$ROOT/apps/web/.env.production.local"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Create $ENV_FILE with VITE_FIREBASE_API_KEY / VITE_FIREBASE_AUTH_DOMAIN / VITE_FIREBASE_PROJECT_ID" >&2
  echo "(and optionally VITE_COLLECT_URL = your sGTM URL + /retrgtr). VITE_API_URL is set automatically." >&2
  exit 1
fi
(cd "$ROOT" && VITE_API_URL="$API_URL" npm run build -w web)

echo "==> Deploying to Firebase Hosting"
(cd "$ROOT/apps/web" && npx firebase-tools@latest deploy --only hosting --project "$PROJECT_ID")
echo "Done. Dashboard: $WEB_ORIGIN  API: $API_URL"
