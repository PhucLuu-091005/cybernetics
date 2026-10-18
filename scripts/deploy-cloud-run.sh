#!/usr/bin/env bash
# Deploys the app to Google Cloud Run from this folder (Cloud Build builds the Dockerfile).
# Reads every value from the environment and stops before any gcloud call when one is missing.
# Secret values go to Secret Manager through stdin only; the script never prints them.
# Steps and values: docs/deploy-cloud-run-neon.md.
set -euo pipefail

SERVICE="${SERVICE:-promise-graph}"
REGION="${REGION:-asia-southeast1}"
UPDATE_SECRETS="${UPDATE_SECRETS:-0}"

missing=""
for name in GCP_PROJECT_ID NEXT_PUBLIC_APP_URL SESSION_SECRET GOOGLE_CLIENT_ID \
  GOOGLE_CLIENT_SECRET DATABASE_URL MIGRATE_DATABASE_URL; do
  if [ -z "${!name:-}" ]; then missing="$missing $name"; fi
done
if [ -n "$missing" ]; then
  echo "Missing values:$missing" >&2
  echo "Set each one in the environment, then run this script again." >&2
  exit 2
fi

problems=""
case "$NEXT_PUBLIC_APP_URL" in
  https://*) ;;
  *) problems="$problems\n- NEXT_PUBLIC_APP_URL must start with https://" ;;
esac
case "$NEXT_PUBLIC_APP_URL" in
  */) problems="$problems\n- NEXT_PUBLIC_APP_URL must not end with /" ;;
esac
if [ "$(printf '%s' "$SESSION_SECRET" | wc -c | tr -d ' ')" -lt 32 ]; then
  problems="$problems\n- SESSION_SECRET must have at least 32 bytes (openssl rand -hex 32)"
fi
host_of() { printf '%s' "$1" | sed -E 's#^[a-z]+://([^@/]*@)?([^/:?]+).*#\2#'; }
case "$(host_of "$DATABASE_URL")" in
  *-pooler.*) ;;
  *) problems="$problems\n- DATABASE_URL must be the pooled Neon URL (its host has -pooler)" ;;
esac
case "$(host_of "$MIGRATE_DATABASE_URL")" in
  *-pooler.*) problems="$problems\n- MIGRATE_DATABASE_URL must be the direct Neon URL (no -pooler in its host)" ;;
esac
if [ -n "$problems" ]; then
  printf "Wrong values:%b\n" "$problems" >&2
  exit 2
fi
if ! command -v gcloud > /dev/null 2>&1; then
  echo "gcloud is not installed: see step 3 of docs/deploy-cloud-run-neon.md" >&2
  exit 2
fi

project_number="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
runtime_account="${project_number}-compute@developer.gserviceaccount.com"

# Creates the secret once. A second run keeps it, unless UPDATE_SECRETS=1: then it adds a version
# and destroys the older ones, so the project stays under the 6 free active versions.
put_secret() {
  local secret="$1" value="$2"
  if ! gcloud secrets describe "$secret" --project "$GCP_PROJECT_ID" > /dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets create "$secret" --project "$GCP_PROJECT_ID" \
      --replication-policy automatic --data-file=- > /dev/null
    echo "Created secret $secret"
  elif [ "$UPDATE_SECRETS" = "1" ]; then
    printf '%s' "$value" | gcloud secrets versions add "$secret" --project "$GCP_PROJECT_ID" \
      --data-file=- > /dev/null
    local old
    for old in $(gcloud secrets versions list "$secret" --project "$GCP_PROJECT_ID" \
      --filter='state=ENABLED' --sort-by='~createTime' --format='value(name.basename())' | tail -n +2); do
      gcloud secrets versions destroy "$old" --secret "$secret" --project "$GCP_PROJECT_ID" \
        --quiet > /dev/null
    done
    echo "Updated secret $secret"
  else
    echo "Kept secret $secret (UPDATE_SECRETS=1 replaces it)"
  fi
  gcloud secrets add-iam-policy-binding "$secret" --project "$GCP_PROJECT_ID" \
    --member "serviceAccount:$runtime_account" \
    --role roles/secretmanager.secretAccessor --quiet > /dev/null
}

put_secret "$SERVICE-session-secret" "$SESSION_SECRET"
put_secret "$SERVICE-google-client-secret" "$GOOGLE_CLIENT_SECRET"
put_secret "$SERVICE-database-url" "$DATABASE_URL"
put_secret "$SERVICE-migrate-database-url" "$MIGRATE_DATABASE_URL"

# One instance: the rate limits live in process memory. Request-based billing (the default CPU
# throttling) and no minimum instance keep an idle service at zero cost.
gcloud run deploy "$SERVICE" \
  --project "$GCP_PROJECT_ID" \
  --region "$REGION" \
  --source . \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 1 \
  --cpu 1 \
  --memory 512Mi \
  --concurrency 80 \
  --timeout 300 \
  --startup-probe "httpGet.path=/api/health,periodSeconds=5,timeoutSeconds=3,failureThreshold=24" \
  --set-env-vars "AUTH_MODE=google,NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" \
  --set-secrets "SESSION_SECRET=$SERVICE-session-secret:latest,GOOGLE_CLIENT_SECRET=$SERVICE-google-client-secret:latest,DATABASE_URL=$SERVICE-database-url:latest,MIGRATE_DATABASE_URL=$SERVICE-migrate-database-url:latest" \
  --quiet

described="$(gcloud run services describe "$SERVICE" --project "$GCP_PROJECT_ID" --region "$REGION" --format=json)"
service_url="$(gcloud run services describe "$SERVICE" --project "$GCP_PROJECT_ID" --region "$REGION" --format='value(status.url)')"
echo "Service URL: $service_url"
case "$described" in
  *"$NEXT_PUBLIC_APP_URL\""* | *"$NEXT_PUBLIC_APP_URL\\\""*)
    echo "Google OAuth redirect URI: $NEXT_PUBLIC_APP_URL/api/auth/google/callback"
    ;;
  *)
    echo "NEXT_PUBLIC_APP_URL ($NEXT_PUBLIC_APP_URL) is not a URL of this service." >&2
    echo "Run this, then add $service_url/api/auth/google/callback to the Google OAuth client:" >&2
    echo "  gcloud run services update $SERVICE --project $GCP_PROJECT_ID --region $REGION --update-env-vars NEXT_PUBLIC_APP_URL=$service_url" >&2
    exit 3
    ;;
esac
