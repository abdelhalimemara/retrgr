#!/usr/bin/env bash
# Deploys a server-side GTM tagging server + preview server on Cloud Run (me-central1 by default),
# using Google's official image. Get CONTAINER_CONFIG from GTM → Admin → Container
# Settings of your *Server* container ("Manually provision tagging server").
#
#   CONTAINER_CONFIG='aWQ9R1RNLV...' PROJECT_ID=my-project ./scripts/deploy-sgtm.sh
#
# ONE server container serves every partner; partners only add the collector
# snippet (with their partner key) to their own web GTM.
# Then in the sGTM container: import config/sgtm/retrgtr-client.tpl as a Client
# template, add a "Retrgtr Client" client (API URL, shared secret from Secret
# Manager `retrgtr-sgtm-secret`; leave allowed origins empty — the API checks each
# partner's registered websites), and add your GA4 / Meta CAPI /
# TikTok Events API / Snap CAPI / Google Ads tags triggered on event names
# `ooh_scan` and `generate_lead`. Gate activation tags on the event-data key
# `x-retrgtr-ad-personalization` equals true.
#
# For production, map a first-party subdomain (e.g. sgtm.brand.sa) to the
# tagging service and set it as data-endpoint on the collector.
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
: "${CONTAINER_CONFIG:?Set CONTAINER_CONFIG from the GTM server container settings}"
REGION="${REGION:-me-central1}"
IMAGE="gcr.io/cloud-tagging-10302018/gtm-cloud-image:stable"

gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Preview server"
gcloud run deploy sgtm-preview --image "$IMAGE" --region "$REGION" --no-invoker-iam-check \
  --min-instances 0 --max-instances 1 --memory 512Mi --cpu 1 \
  --set-env-vars "RUN_AS_PREVIEW_SERVER=true,CONTAINER_CONFIG=${CONTAINER_CONFIG}"
PREVIEW_URL="$(gcloud run services describe sgtm-preview --region "$REGION" --format 'value(status.url)')"

echo "==> Tagging server"
gcloud run deploy sgtm --image "$IMAGE" --region "$REGION" --no-invoker-iam-check \
  --min-instances 1 --max-instances 10 --memory 512Mi --cpu 1 \
  --set-env-vars "PREVIEW_SERVER_URL=${PREVIEW_URL},CONTAINER_CONFIG=${CONTAINER_CONFIG}"
SGTM_URL="$(gcloud run services describe sgtm --region "$REGION" --format 'value(status.url)')"

echo
echo "Tagging server: $SGTM_URL   (set as the Server container URL in GTM)"
echo "Preview server: $PREVIEW_URL"
echo "Collector endpoint: data-endpoint=\"$SGTM_URL\" data-path=\"/retrgtr\""
echo "Shared secret for the Retrgtr Client:"
echo "  gcloud secrets versions access latest --secret retrgtr-sgtm-secret"
