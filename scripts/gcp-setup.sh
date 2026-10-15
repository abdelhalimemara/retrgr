#!/usr/bin/env bash
# One-time GCP provisioning for Retrgtr. Everything that stores personal data
# lives in me-central1 (Doha), the nearest open region; me-central2 (Dammam)
# needs Google sales enablement. Set REGION=me-central2 once it is granted.
#
#   PROJECT_ID=my-project ./scripts/gcp-setup.sh
#
# Idempotent-ish: re-running skips resources that already exist.
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-me-central1}"
SQL_INSTANCE="${SQL_INSTANCE:-retrgtr-db}"
SQL_TIER="${SQL_TIER:-db-custom-1-3840}"
BQ_DATASET="${BQ_DATASET:-retrgtr_events}"
AR_REPO="${AR_REPO:-retrgtr}"
SA_NAME="retrgtr-api"
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RETENTION_SECONDS=$((730 * 24 * 3600)) # 24-month event retention (brief §6)

exists() { "$@" >/dev/null 2>&1; }
gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com bigquery.googleapis.com \
  identitytoolkit.googleapis.com iam.googleapis.com cloudscheduler.googleapis.com

echo "==> Artifact Registry"
exists gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" ||
  gcloud artifacts repositories create "$AR_REPO" --repository-format docker --location "$REGION"

echo "==> Cloud SQL (Postgres 16) — this takes several minutes the first time"
if ! exists gcloud sql instances describe "$SQL_INSTANCE"; then
  gcloud sql instances create "$SQL_INSTANCE" --database-version POSTGRES_16 --region "$REGION" \
    --edition ENTERPRISE --tier "$SQL_TIER" --storage-auto-increase \
    --backup-start-time 00:00 --enable-point-in-time-recovery \
    --database-flags cloudsql.iam_authentication=on
fi
exists gcloud sql databases describe retrgtr --instance "$SQL_INSTANCE" ||
  gcloud sql databases create retrgtr --instance "$SQL_INSTANCE"

echo "==> Secrets"
create_secret() { # name value
  if ! exists gcloud secrets describe "$1"; then
    printf '%s' "$2" | gcloud secrets create "$1" --data-file - --replication-policy user-managed --locations "$REGION"
  fi
}
if ! exists gcloud secrets describe retrgtr-db-password; then
  DB_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=')"
  gcloud sql users create retrgtr --instance "$SQL_INSTANCE" --password "$DB_PASSWORD"
  create_secret retrgtr-db-password "$DB_PASSWORD"
fi
create_secret retrgtr-sgtm-secret "$(openssl rand -hex 32)"

echo "==> Service account"
exists gcloud iam service-accounts describe "$SA" ||
  gcloud iam service-accounts create "$SA_NAME" --display-name "Retrgtr API"
for role in roles/cloudsql.client roles/bigquery.jobUser roles/firebaseauth.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$SA" --role "$role" --condition None >/dev/null
done
for secret in retrgtr-db-password retrgtr-sgtm-secret; do
  gcloud secrets add-iam-policy-binding "$secret" --member "serviceAccount:$SA" \
    --role roles/secretmanager.secretAccessor >/dev/null
done

echo "==> BigQuery dataset + tables (${REGION}, ${RETENTION_SECONDS}s partition expiry)"
exists bq --location "$REGION" show "$PROJECT_ID:$BQ_DATASET" ||
  bq --location "$REGION" mk --dataset --description "Retrgtr pseudonymous OOH events" "$PROJECT_ID:$BQ_DATASET"
mk_table() { # table partition_field clustering schema
  exists bq show "$PROJECT_ID:$BQ_DATASET.$1" ||
    bq mk --table --time_partitioning_field "$2" --time_partitioning_type DAY \
      --time_partitioning_expiration "$RETENTION_SECONDS" --clustering_fields "$3" \
      "$PROJECT_ID:$BQ_DATASET.$1" "$ROOT/config/bigquery/$4"
}
mk_table scan_events scan_ts bid,campaign_id scan_events.json
mk_table engagement_events event_ts scan_id engagement_events.json
# Aggregated Google Signals reads per billboard — never joined to users (brief §3, §7).
mk_table billboard_demographics report_date billboard_id billboard_demographics.json
# Dataset-level WRITER (= dataEditor) for the API, via the dataset access list.
ACL="$(mktemp)"
bq show --format=prettyjson "$PROJECT_ID:$BQ_DATASET" | python3 -c "
import json, sys
d = json.load(sys.stdin); sa = sys.argv[1]
acl = d.get('access', [])
if not any(a.get('userByEmail') == sa for a in acl):
    acl.append({'role': 'WRITER', 'userByEmail': sa})
json.dump({'access': acl}, sys.stdout)" "$SA" >"$ACL"
bq update --source "$ACL" "$PROJECT_ID:$BQ_DATASET" >/dev/null
rm -f "$ACL"

cat <<EOF

Done. Next steps:
  1. Firebase: add this project in the Firebase console, enable Authentication
     (Email/Password + Google), create the dashboard users, and add a Web app to
     get VITE_FIREBASE_* values. Enable Hosting.
  2. GTM: create a Server container, copy its Container Config string, then:
       CONTAINER_CONFIG='...' PROJECT_ID=$PROJECT_ID ./scripts/deploy-sgtm.sh
  3. Deploy the app:
       PROJECT_ID=$PROJECT_ID ADMIN_EMAILS=you@company.com ./scripts/deploy.sh
EOF
