# Deploy on Google Cloud Run and Neon

This guide puts the app on the internet for free, or close to free. Google Cloud Run runs the container. Neon runs PostgreSQL. You need no GCP experience. Do the steps in this order.

You need:

- a Google account;
- a credit or debit card, because Google Cloud needs a billing account even for the free tier;
- a computer with this repository and a terminal (macOS or Linux).

The free limits that matter (checked on 18 October 2026):

| Service | Free each month |
|---|---|
| Neon Free | 100 CU-hours of compute and 1 GB of storage per project, 5 GB of egress, no expiry. The database stops after 5 minutes without queries and wakes on the next query in about one second. |
| Cloud Run | 2 million requests, 180,000 vCPU-seconds, 360,000 GB-seconds. |
| Cloud Build | 2,500 build-minutes. |
| Artifact Registry | 0.5 GB of storage. |
| Secret Manager | 6 active secret versions, 10,000 access operations. |

## 1. Create the Neon database

1. Go to <https://neon.tech> and sign up. The Free plan needs no card.
2. Create a project. Name it `promise-graph`. Select the region **AWS Asia Pacific 1 (Singapore)** (`aws-ap-southeast-1`), close to Cloud Run in Singapore. Select PostgreSQL 17.
3. On the project dashboard, select **Connect**. Keep the database `neondb` and the role `neondb_owner`. Copy two URLs from that dialog:
   - With **Connection pooling** on, copy the URL. Its host has `-pooler` in it. This is `DATABASE_URL`. The app uses it.
   - With **Connection pooling** off, copy the URL again. Its host has no `-pooler`. This is `MIGRATE_DATABASE_URL`. The migration step at each start uses it.
4. In both URLs, change `sslmode=require` to `sslmode=verify-full`, and remove `&channel_binding=require` if it is there. The `pg` driver treats `require` as `verify-full` already and prints a warning for it; `verify-full` checks the certificate of Neon with no warning. The driver ignores `channel_binding`.

The app needs the two URLs for these reasons:

- The pooler (PgBouncer in transaction mode) lets many short app connections share a few database connections. It refuses session features: session advisory locks and startup options.
- The migration step takes a session advisory lock, so that two containers that start at once never apply the same migration twice. A lock through the pooler can land on another database connection and lock nothing, so the migration step refuses a `-pooler` URL.
- The migration step also sets UTC as the default time zone of the role. The app needs UTC, and the pooler does not accept the time zone as a startup option.

## 2. Create the Google Cloud project

1. Go to <https://console.cloud.google.com> and sign in.
2. At the top, open the project list and select **New project**. Name it, for example `promise-graph-demo`. Write down the **Project ID** that the form shows. This is `GCP_PROJECT_ID`.
3. Open **Billing** in the menu and link the project to a billing account. Create a billing account with your card if you have none. Cloud Run refuses to deploy without billing.
4. Optional, but do it: in **Billing → Budgets & alerts**, create a budget of 1 USD with email alerts. A budget only sends email. It does not stop the service.

## 3. Install and set up gcloud

1. Install the Google Cloud CLI: <https://cloud.google.com/sdk/docs/install>. On macOS with Homebrew: `brew install --cask google-cloud-sdk`.
2. Sign in and select the project:

   ```sh
   gcloud auth login
   gcloud config set project <GCP_PROJECT_ID>
   ```

3. Enable the five services that the deploy uses:

   ```sh
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
     artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com
   ```

4. Read the project number. You need it for the service URL in step 4.

   ```sh
   gcloud projects describe <GCP_PROJECT_ID> --format='value(projectNumber)'
   ```

## 4. Know the service URL before the first deploy

Cloud Run gives the service a fixed URL made of the service name, the project number and the region:

```text
https://promise-graph-<PROJECT_NUMBER>.asia-southeast1.run.app
```

This URL is `NEXT_PUBLIC_APP_URL`. Write it without a `/` at the end. The deploy script checks it after the deploy and tells you the command to fix it if the service got another URL.

## 5. Create the Google OAuth client

1. In the Cloud console, go to **APIs & Services → OAuth consent screen**. Select **External**. Fill in the app name and your email. Add the scopes `openid`, `email` and `profile`. Set the publishing status to **In production**. In **Testing**, only the listed test users can sign in.
2. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**. Select **Web application**.
3. Under **Authorized redirect URIs**, add `<NEXT_PUBLIC_APP_URL>/api/auth/google/callback`, for example `https://promise-graph-123456789012.asia-southeast1.run.app/api/auth/google/callback`.
4. Select **Create**. Copy the client ID (`GOOGLE_CLIENT_ID`) and the client secret (`GOOGLE_CLIENT_SECRET`).

## 6. Deploy

1. Make a session secret. Do not reuse one from another app.

   ```sh
   openssl rand -hex 32
   ```

2. Put the values in a file outside the repository that only you can read. Do not type them on the command line: zsh and bash save each command in a history file (`~/.zsh_history`), so a secret typed there stays on the disk.

   ```sh
   mkdir -p ~/.config/promise-graph
   touch ~/.config/promise-graph/deploy.env
   chmod 600 ~/.config/promise-graph/deploy.env
   open -e ~/.config/promise-graph/deploy.env   # or any text editor
   ```

   Write these lines in the file and save it:

   ```sh
   export GCP_PROJECT_ID=promise-graph-demo
   export NEXT_PUBLIC_APP_URL=https://promise-graph-<PROJECT_NUMBER>.asia-southeast1.run.app
   export SESSION_SECRET=<the output of openssl rand -hex 32>
   export GOOGLE_CLIENT_ID=<client id>
   export GOOGLE_CLIENT_SECRET=<client secret>
   export DATABASE_URL='<the -pooler URL from Neon>'
   export MIGRATE_DATABASE_URL='<the direct URL from Neon>'
   ```

   The file is outside the repository, so `git` and the Cloud Build upload never see it. `chmod 600` lets only your user read it. After the deploy works, you can delete it: the values live in Secret Manager.

3. From the repository root, load the file and run the script in one subshell, so the values do not stay in your terminal:

   ```sh
   (source ~/.config/promise-graph/deploy.env && scripts/deploy-cloud-run.sh)
   ```

The script does these things:

1. It stops before it calls gcloud when a value is missing or wrong: an origin without `https://`, a session secret under 32 bytes, a `DATABASE_URL` without `-pooler`, or a `MIGRATE_DATABASE_URL` with `-pooler`.
2. It creates the service account `promise-graph-runtime@<GCP_PROJECT_ID>.iam.gserviceaccount.com` once. The service runs as this account. The account gets no project role: it can only read the four secrets below. Cloud Run writes the logs of the service without a role on the account.
3. It stores `SESSION_SECRET`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL` and `MIGRATE_DATABASE_URL` in Secret Manager as `promise-graph-session-secret`, `promise-graph-google-client-secret`, `promise-graph-database-url` and `promise-graph-migrate-database-url`. It sends each value on stdin and never prints it. It lets the runtime account read each one.
4. It runs one `gcloud run deploy`. Cloud Build builds the `Dockerfile`, and Cloud Run starts it in `asia-southeast1`:

   ```sh
   gcloud run deploy promise-graph --project "$GCP_PROJECT_ID" --region asia-southeast1 --source . \
     --service-account "promise-graph-runtime@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
     --allow-unauthenticated --min-instances 0 --max-instances 1 --cpu 1 --memory 512Mi \
     --concurrency 80 --timeout 300 \
     --startup-probe "httpGet.path=/api/health,periodSeconds=5,timeoutSeconds=3,failureThreshold=24" \
     --set-env-vars "AUTH_MODE=google,NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" \
     --set-secrets "SESSION_SECRET=promise-graph-session-secret:latest,GOOGLE_CLIENT_SECRET=promise-graph-google-client-secret:latest,DATABASE_URL=promise-graph-database-url:latest,MIGRATE_DATABASE_URL=promise-graph-migrate-database-url:latest"
   ```

5. With `UPDATE_SECRETS=1`, it destroys the old secret versions, only after the deploy works (see step 8).
6. It prints the service URL and the OAuth redirect URI. If `NEXT_PUBLIC_APP_URL` is not a URL of the service, it prints a `gcloud run services update … --update-env-vars NEXT_PUBLIC_APP_URL=…` command and exits with status 3. Run that command, and add the printed redirect URI to the OAuth client (step 5). The update makes a new revision without a new build.

The first build takes about 5 minutes. The first time, gcloud asks to create an Artifact Registry repository named `cloud-run-source-deploy`; the script answers yes.

Why these settings:

- `--max-instances 1`: the app keeps its rate limits in process memory, so a second instance would double them. It also keeps the Neon connections low: one instance opens at most 5 app connections and 1 migration connection.
- `--min-instances 0`: an idle service costs nothing. The first request after an idle time waits for a cold start of a few seconds.
- The startup probe calls `/api/health` on the port that Cloud Run gives in `PORT` (8080). The container first applies the migrations, then starts the server, so Cloud Run sends traffic only after both. The probe allows 2 minutes, which covers a Neon wake-up (about one second) and the migration step. The database connection timeout is 10 seconds in the app and 15 seconds in the migration step.
- `/api/health` does not touch the database, so a probe never keeps Neon awake.

## 7. Check the deploy

1. Open `<NEXT_PUBLIC_APP_URL>/api/health`. It returns `{"status":"ok"}`.
2. Read the logs of the start, in the console (**Cloud Run → promise-graph → Logs**) or with:

   ```sh
   gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="promise-graph"' \
     --project "$GCP_PROJECT_ID" --freshness 1h --limit 50 --format json | grep '"event"'
   ```

   Cloud Run reads each JSON line of the container into `jsonPayload`, so look for `"event": "migrations_applied"`. `"event": "migrations_waiting"` means that another container held the migration lock; the start goes on when that container is done. `"event": "migrations_failed"` means that the container stopped, and Cloud Run keeps the previous revision. Its `message` says why.
3. Open `NEXT_PUBLIC_APP_URL`, select **Continue with Google** and sign in. The first sign-in of each account builds its Larkspur sandbox, so it takes longer than later sign-ins.

## 8. Deploy again

- After a code change, run `scripts/deploy-cloud-run.sh` again with the same values. It keeps the stored secrets.
- To change a secret, run it with `UPDATE_SECRETS=1`. It adds a new version of each secret. After the deploy works, it destroys the older versions, so the project keeps 4 active versions, under the free 6. When the deploy fails, it destroys nothing. When it cannot list the versions, it stops with status 4; then destroy the old versions in the console (**Security → Secret Manager**).
- To change only `NEXT_PUBLIC_APP_URL` or `GOOGLE_CLIENT_ID`, use `gcloud run services update promise-graph --region asia-southeast1 --update-env-vars KEY=value`. No build is needed.

## 9. Stay inside the free tier

- Keep `--min-instances 0` and the default CPU throttling. Cloud Run then bills only while a request runs.
- Each deploy stores a new image in Artifact Registry, and the free storage is 0.5 GB. Delete old images after a few deploys: in the console, open **Artifact Registry → cloud-run-source-deploy → promise-graph** and delete all but the newest. Or set a cleanup policy there that keeps the 2 newest versions.
- Cloud Build gets 2,500 free build-minutes a month; one build takes about 5 minutes.
- Keep 4 secrets with one active version each.
- Do not add an uptime monitor: Neon then sleeps after 5 minutes, and its 100 CU-hours last the month.
- Check **Billing → Reports** once a week.

## Deploy from a tag

After the first deploy by hand (steps 1 to 7), GitHub Actions can deploy each tag that starts with `v`. The workflow `.github/workflows/deploy.yml` runs the same checks as CI. When they pass, it builds the `Dockerfile`, pushes the image to Artifact Registry and deploys it. It changes only the image: the service keeps its env vars, secrets, service account and limits. GitHub signs in to Google through Workload Identity Federation, so no service account key exists anywhere.

Set it up once:

1. Sign in to gcloud as the project owner (step 3), then run the setup script from the repository root:

   ```sh
   GCP_PROJECT_ID=promise-graph GITHUB_REPOSITORY=PhucLuu-091005/cybernetics scripts/setup-github-cd.sh
   ```

   The script does these things. A second run creates nothing new.
   - It creates the Docker repository `promise-graph` in `asia-southeast1`, with a cleanup policy that keeps the 3 newest images.
   - It creates the account `promise-graph-deployer`. The account gets `roles/run.developer` on the service, `roles/artifactregistry.writer` on the repository and `roles/iam.serviceAccountUser` on the runtime account. It gets no other role.
   - It creates a Workload Identity pool and an OIDC provider for GitHub. The provider accepts only runs of `PhucLuu-091005/cybernetics` on a tag that starts with `v`.

2. The script prints two `gh variable set` commands. Run them. They set the repository variables `GCP_WIF_PROVIDER` and `GCP_DEPLOYER_SA`. Neither value is secret, so they are variables, not secrets.

Deploy:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

Watch the run in the **Actions** tab or with `gh run watch`. The job summary shows the service URL after `/api/health` returns `ok`. A failed check stops the run before the deploy.

To deploy an earlier tag again, start the workflow from that tag:

```sh
gh workflow run deploy.yml --ref v0.1.0 -f tag=v0.1.0
```

The deploy job runs in the GitHub environment `production`. To make each deploy wait for an approval, add a required reviewer to that environment in **Settings → Environments**. To change a secret or an env var, use `scripts/deploy-cloud-run.sh` or `gcloud run services update` as in step 8.

The free limits that matter here:

- GitHub Actions: a public repository gets free minutes with no limit. A private repository on the Free plan gets 2,000 minutes a month. One tag uses about 20 to 30 minutes, because the checks, the end-to-end tests and the image build each take a runner.
- Artifact Registry: 0.5 GB of storage for the whole project. The cleanup policy keeps the 3 newest images in `promise-graph` and deletes the others. Artifact Registry runs the policy about once a day. The images of the deploys by hand stay in `cloud-run-source-deploy`, so delete them there (step 9).

## Troubleshooting

- **The build fails with a permission error on the service account.** Cloud Build builds the image as the default compute service account. Some new projects do not give that account the build role. Run:

  ```sh
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member "serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
    --role roles/run.builder
  ```

- **`migrations_failed` with code `28P01` (password authentication failed).** The password in a Neon URL is old, for example after a password reset in Neon. Copy both URLs again (step 1), put them in the env file, then run the script with `UPDATE_SECRETS=1`.
- **Google says `redirect_uri_mismatch`.** The redirect URI in the OAuth client must equal `NEXT_PUBLIC_APP_URL` followed by `/api/auth/google/callback`.
- **The page says "Production requires HTTPS".** `NEXT_PUBLIC_APP_URL` starts with `http://`. Set it to the `https://` service URL.
- **A request fails once after a long idle time.** Neon closes idle connections when it stops. The app drops a closed connection and opens a new one, so a reload works.
