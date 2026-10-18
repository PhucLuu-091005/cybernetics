#!/usr/bin/env bash
# Sets up the Google side of .github/workflows/deploy.yml, once, after the first manual deploy
# (scripts/deploy-cloud-run.sh). Running it again changes nothing that is already right.
# It makes no key: GitHub signs in through Workload Identity Federation.
# Steps and values: docs/deploy-cloud-run-neon.md ("Deploy from a tag").
set -euo pipefail

SERVICE="${SERVICE:-promise-graph}"
REGION="${REGION:-asia-southeast1}"
REPOSITORY="${REPOSITORY:-promise-graph}"
POOL=github-actions
PROVIDER=github

missing=""
for name in GCP_PROJECT_ID GITHUB_REPOSITORY; do
  if [ -z "${!name:-}" ]; then missing="$missing $name"; fi
done
if [ -n "$missing" ]; then
  echo "Missing values:$missing" >&2
  echo "Example: GCP_PROJECT_ID=promise-graph GITHUB_REPOSITORY=PhucLuu-091005/cybernetics $0" >&2
  exit 2
fi

# The repository name goes into the attribute condition between quotes, so it must be a plain name.
problems=""
if ! printf '%s' "$GITHUB_REPOSITORY" | grep -Eq '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$'; then
  problems="$problems\n- GITHUB_REPOSITORY must look like owner/name, for example PhucLuu-091005/cybernetics"
fi
if ! printf '%s' "$GCP_PROJECT_ID" | grep -Eq '^[a-z][a-z0-9-]{4,28}[a-z0-9]$'; then
  problems="$problems\n- GCP_PROJECT_ID must be a project ID (lower case letters, digits and -), not the project name"
fi
if [ -n "$problems" ]; then
  printf "Wrong values:%b\n" "$problems" >&2
  exit 2
fi
if ! command -v gcloud > /dev/null 2>&1; then
  echo "gcloud is not installed: see docs/deploy-cloud-run-neon.md" >&2
  exit 2
fi

project="$GCP_PROJECT_ID"
runtime="$SERVICE-runtime@$project.iam.gserviceaccount.com"
deployer_name="$SERVICE-deployer"
deployer="$deployer_name@$project.iam.gserviceaccount.com"

number="$(gcloud projects describe "$project" --format='value(projectNumber)')"
if [ -z "$number" ]; then
  echo "Could not read the project number of $project: check the project ID and gcloud auth login" >&2
  exit 2
fi
pool_path="projects/$number/locations/global/workloadIdentityPools/$POOL"
provider_path="$pool_path/providers/$PROVIDER"

# The workflow only swaps the image, so the service and its runtime account must exist with their config.
if ! gcloud run services describe "$SERVICE" --project "$project" --region "$REGION" > /dev/null 2>&1 ||
  ! gcloud iam service-accounts describe "$runtime" --project "$project" > /dev/null 2>&1; then
  echo "The service $SERVICE or its account $runtime does not exist in $project." >&2
  echo "Deploy once by hand with scripts/deploy-cloud-run.sh, then run this script again." >&2
  exit 3
fi

echo "Enabling the APIs that the GitHub deploy uses"
gcloud services enable artifactregistry.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com iam.googleapis.com run.googleapis.com --project "$project"

if gcloud artifacts repositories describe "$REPOSITORY" --project "$project" --location "$REGION" > /dev/null 2>&1; then
  echo "Kept the Artifact Registry repository $REPOSITORY"
else
  echo "Creating the Artifact Registry repository $REPOSITORY in $REGION"
  gcloud artifacts repositories create "$REPOSITORY" --project "$project" --location "$REGION" \
    --repository-format docker --description "Images that the GitHub deploy pushes" > /dev/null
fi

# Each deploy pushes one image (two tags, one digest). Three images stay far under the free 0.5 GB.
policy="$(mktemp)"
trap 'rm -f "$policy"' EXIT
cat > "$policy" <<'JSON'
[
  { "name": "keep-3-newest", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 3 } },
  { "name": "delete-the-rest", "action": { "type": "Delete" }, "condition": { "tagState": "any" } }
]
JSON
echo "Setting the cleanup policy of $REPOSITORY: keep the 3 newest images, delete the rest"
gcloud artifacts repositories set-cleanup-policies "$REPOSITORY" --project "$project" \
  --location "$REGION" --policy "$policy" --no-dry-run > /dev/null

if gcloud iam service-accounts describe "$deployer" --project "$project" > /dev/null 2>&1; then
  echo "Kept the service account $deployer"
else
  echo "Creating the service account $deployer"
  gcloud iam service-accounts create "$deployer_name" --project "$project" \
    --display-name "Promise Graph deploys from GitHub" > /dev/null
fi

# A new account can take a few seconds to show up in IAM, so a grant may need a retry.
grant() {
  local what="$1" attempt
  shift
  echo "Granting $what"
  for attempt in 1 2 3 4 5; do
    if gcloud "$@" --quiet > /dev/null; then return 0; fi
    [ "$attempt" = 5 ] || sleep 5
  done
  echo "Could not grant $what" >&2
  exit 4
}
grant "roles/run.developer on the service $SERVICE to $deployer" \
  run services add-iam-policy-binding "$SERVICE" --project "$project" --region "$REGION" \
  --member "serviceAccount:$deployer" --role roles/run.developer
grant "roles/artifactregistry.writer on the repository $REPOSITORY to $deployer" \
  artifacts repositories add-iam-policy-binding "$REPOSITORY" --project "$project" \
  --location "$REGION" --member "serviceAccount:$deployer" --role roles/artifactregistry.writer
grant "roles/iam.serviceAccountUser on $runtime to $deployer" \
  iam service-accounts add-iam-policy-binding "$runtime" --project "$project" \
  --member "serviceAccount:$deployer" --role roles/iam.serviceAccountUser

if gcloud iam workload-identity-pools describe "$POOL" --project "$project" --location global > /dev/null 2>&1; then
  echo "Kept the Workload Identity pool $POOL"
else
  echo "Creating the Workload Identity pool $POOL"
  gcloud iam workload-identity-pools create "$POOL" --project "$project" --location global \
    --display-name "GitHub Actions" > /dev/null
fi

mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.ref_type=assertion.ref_type"
condition="assertion.repository == '$GITHUB_REPOSITORY' && assertion.ref_type == 'tag' && assertion.ref.startsWith('refs/tags/v')"
if gcloud iam workload-identity-pools providers describe "$PROVIDER" --project "$project" \
  --location global --workload-identity-pool "$POOL" > /dev/null 2>&1; then
  echo "Updating the OIDC provider $PROVIDER: only v* tags of $GITHUB_REPOSITORY"
  verb=update-oidc
else
  echo "Creating the OIDC provider $PROVIDER: only v* tags of $GITHUB_REPOSITORY"
  verb=create-oidc
fi
gcloud iam workload-identity-pools providers "$verb" "$PROVIDER" --project "$project" \
  --location global --workload-identity-pool "$POOL" \
  --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping "$mapping" --attribute-condition "$condition" > /dev/null

grant "roles/iam.workloadIdentityUser on $deployer to the runs of $GITHUB_REPOSITORY" \
  iam service-accounts add-iam-policy-binding "$deployer" --project "$project" \
  --member "principalSet://iam.googleapis.com/$pool_path/attribute.repository/$GITHUB_REPOSITORY" \
  --role roles/iam.workloadIdentityUser

echo
echo "Done. The workflow needs these two repository variables (not secrets: neither value is secret):"
echo "  GCP_WIF_PROVIDER=$provider_path"
echo "  GCP_DEPLOYER_SA=$deployer"
echo
echo "Set them with:"
echo "  gh variable set GCP_WIF_PROVIDER --repo $GITHUB_REPOSITORY --body $provider_path"
echo "  gh variable set GCP_DEPLOYER_SA --repo $GITHUB_REPOSITORY --body $deployer"
