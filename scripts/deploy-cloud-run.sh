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
for tool in gcloud node; do
  if ! command -v "$tool" > /dev/null 2>&1; then
    echo "$tool is not installed: see docs/deploy-cloud-run-neon.md" >&2
    exit 2
  fi
done

# The service runs as its own account, which can read these four secrets and nothing else.
runtime_name="$SERVICE-runtime"
runtime_account="$runtime_name@$GCP_PROJECT_ID.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$runtime_account" --project "$GCP_PROJECT_ID" > /dev/null 2>&1; then
  gcloud iam service-accounts create "$runtime_name" --project "$GCP_PROJECT_ID" \
    --display-name "Promise Graph on Cloud Run" > /dev/null
  echo "Created service account $runtime_account"
fi

# A new account can take a few seconds to show up in IAM, so the first grant may need a retry.
grant_secret() {
  local secret="$1" attempt
  for attempt in 1 2 3 4 5; do
    if gcloud secrets add-iam-policy-binding "$secret" --project "$GCP_PROJECT_ID" \
      --member "serviceAccount:$runtime_account" \
      --role roles/secretmanager.secretAccessor --quiet > /dev/null; then
      return 0
    fi
    [ "$attempt" = 5 ] || sleep 5
  done
  echo "Could not let $runtime_account read $secret" >&2
  exit 4
}

# Creates the secret once. A second run keeps it, unless UPDATE_SECRETS=1: then it adds a version,
# and the older versions go after a good deploy, so the project stays under 6 active versions.
updated=""
put_secret() {
  local secret="$1" value="$2"
  if ! gcloud secrets describe "$secret" --project "$GCP_PROJECT_ID" > /dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets create "$secret" --project "$GCP_PROJECT_ID" \
      --replication-policy automatic --data-file=- > /dev/null
    echo "Created secret $secret"
  elif [ "$UPDATE_SECRETS" = "1" ]; then
    printf '%s' "$value" | gcloud secrets versions add "$secret" --project "$GCP_PROJECT_ID" \
      --data-file=- > /dev/null
    updated="$updated $secret"
    echo "Added a new version of secret $secret"
  else
    echo "Kept secret $secret (UPDATE_SECRETS=1 replaces it)"
  fi
  grant_secret "$secret"
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
  --service-account "$runtime_account" \
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

for secret in $updated; do
  if ! versions="$(gcloud secrets versions list "$secret" --project "$GCP_PROJECT_ID" \
    --filter='state=ENABLED' --sort-by='~createTime' --format='value(name.basename())')"; then
    echo "Could not list the versions of $secret: destroy the old ones in the console (Security > Secret Manager)" >&2
    exit 4
  fi
  for old in $(printf '%s\n' "$versions" | tail -n +2); do
    gcloud secrets versions destroy "$old" --secret "$secret" --project "$GCP_PROJECT_ID" \
      --quiet > /dev/null
  done
  echo "Destroyed the old versions of secret $secret"
done

# Only the status URL and the URL list count: the JSON also holds the env vars, NEXT_PUBLIC_APP_URL among them.
service_urls="$(gcloud run services describe "$SERVICE" --project "$GCP_PROJECT_ID" --region "$REGION" --format=json |
  node -e '
    let text = "";
    process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
      const service = JSON.parse(text);
      const listed = service.metadata?.annotations?.["run.googleapis.com/urls"];
      const urls = [service.status?.url, ...(listed ? JSON.parse(listed) : [])].filter(Boolean);
      console.log([...new Set(urls)].join("\n"));
    });
  ')"
service_url="$(printf '%s\n' "$service_urls" | head -n 1)"
echo "Service URL: $service_url"
if printf '%s\n' "$service_urls" | grep -qxF "$NEXT_PUBLIC_APP_URL"; then
  echo "Google OAuth redirect URI: $NEXT_PUBLIC_APP_URL/api/auth/google/callback"
else
  echo "NEXT_PUBLIC_APP_URL ($NEXT_PUBLIC_APP_URL) is not a URL of this service." >&2
  echo "Run this, then add $service_url/api/auth/google/callback to the Google OAuth client:" >&2
  echo "  gcloud run services update $SERVICE --project $GCP_PROJECT_ID --region $REGION --update-env-vars NEXT_PUBLIC_APP_URL=$service_url" >&2
  exit 3
fi
