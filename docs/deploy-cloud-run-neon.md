# Deploy on Google Cloud Run and Neon

This guide puts the app on the internet for free, or close to free. Google Cloud Run runs the container. Neon runs PostgreSQL. You need no GCP experience. Do the steps in this order.

The deploy runs the app with `AUTH_MODE=demo`: whoever opens the URL gets their own copy of the Larkspur demo project at once, with no sign-in. Google sign-in is optional; see [Optional: Google sign-in](#optional-google-sign-in-only-for-auth_modegoogle).

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
| Cloud Storage (profile photos) | 5 GB-months of Standard storage, 5,000 Class A and 50,000 Class B operations, 100 GB of egress from North America. Only buckets in `us-east1`, `us-west1` and `us-central1` get it, so the photo bucket is in `us-central1`. |

A profile photo is one WebP of about 10 KB. An upload is one Class A operation (two when it replaces a photo), and each photo that a browser loads for the first time is one Class B operation; the browser then keeps it. Cloud Run in Singapore reads the photos from `us-central1`, which counts as egress from North America: 100 GB is millions of photos.

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

3. Enable the six services that the deploy uses (the script enables Cloud Storage again, which does no harm):

   ```sh
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
     artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com \
     storage.googleapis.com
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

## 5. The photo bucket

Profile photos live in a private Cloud Storage bucket. The script uses the bucket that `AVATAR_BUCKET` names, `promise-graph-avatars` by default.

- If the bucket exists, the script keeps it, but only with uniform bucket-level access on and public access prevention enforced. Otherwise it stops with status 5 before the deploy and prints the `gcloud storage buckets update … --uniform-bucket-level-access --public-access-prevention` command. The owner's bucket `gs://promise-graph-avatars` (project `promise-graph`, `us-central1`, uniform access, public access prevention enforced, soft delete off) is such a bucket.
- If the bucket does not exist, the script creates it in `us-central1` with Standard storage, uniform bucket-level access, enforced public access prevention and no soft delete. To create it yourself first, run the same command:

  ```sh
  gcloud storage buckets create gs://promise-graph-avatars --project "$GCP_PROJECT_ID" \
    --location us-central1 --default-storage-class STANDARD \
    --uniform-bucket-level-access --public-access-prevention --soft-delete-duration 0
  ```

- A bucket name is global. If another Google Cloud account has the name, pick another one and put `export AVATAR_BUCKET=<name>` in the env file of step 6.
- The runtime account gets `roles/storage.objectUser` on this bucket only: it can create, read and delete the photos, and nothing else. No photo is public. The app streams each photo itself, and only to the people who share a project with its person.
- The service gets `AVATAR_STORE=gcs` and `AVATAR_BUCKET`. It reads its credentials from the runtime account (Application Default Credentials), so no key file exists. Without `AVATAR_STORE`, photos are off and every avatar shows initials.

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
   export DATABASE_URL='<the -pooler URL from Neon>'
   export MIGRATE_DATABASE_URL='<the direct URL from Neon>'
   # Optional: another photo bucket than promise-graph-avatars (step 5).
   # export AVATAR_BUCKET=promise-graph-avatars
   ```

   The file is outside the repository, so `git` and the Cloud Build upload never see it. `chmod 600` lets only your user read it. After the deploy works, you can delete it: the values live in Secret Manager.

3. From the repository root, load the file and run the script in one subshell, so the values do not stay in your terminal:

   ```sh
   (source ~/.config/promise-graph/deploy.env && scripts/deploy-cloud-run.sh)
   ```

The script does these things:

1. It stops before it calls gcloud when a value is missing or wrong: an origin without `https://`, a session secret under 32 bytes, a `DATABASE_URL` without `-pooler`, a `MIGRATE_DATABASE_URL` with `-pooler`, or an `AVATAR_BUCKET` that is not a bucket name.
2. It creates the service account `promise-graph-runtime@<GCP_PROJECT_ID>.iam.gserviceaccount.com` once. The service runs as this account. The account gets no project role: it can only read the secrets below and use the photo bucket. Cloud Run writes the logs of the service without a role on the account.
3. It stores `SESSION_SECRET`, `DATABASE_URL` and `MIGRATE_DATABASE_URL` in Secret Manager as `promise-graph-session-secret`, `promise-graph-database-url` and `promise-graph-migrate-database-url`. With `AUTH_MODE=google`, it also stores `GOOGLE_CLIENT_SECRET` as `promise-graph-google-client-secret`. It sends each value on stdin and never prints it. It lets the runtime account read each one.
4. It enables Cloud Storage, keeps or creates the photo bucket (step 5), and gives the runtime account `roles/storage.objectUser` on that bucket.
5. It runs one `gcloud run deploy`. Cloud Build builds the `Dockerfile`, and Cloud Run starts it in `asia-southeast1`:

   ```sh
   gcloud run deploy promise-graph --project "$GCP_PROJECT_ID" --region asia-southeast1 --source . \
     --service-account "promise-graph-runtime@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
     --allow-unauthenticated --min-instances 0 --max-instances 1 --cpu 1 --memory 512Mi \
     --concurrency 80 --timeout 300 \
     --startup-probe "httpGet.path=/api/health,periodSeconds=5,timeoutSeconds=3,failureThreshold=24" \
     --set-env-vars "AUTH_MODE=demo,NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL,AVATAR_STORE=gcs,AVATAR_BUCKET=promise-graph-avatars" \
     --set-secrets "SESSION_SECRET=promise-graph-session-secret:latest,DATABASE_URL=promise-graph-database-url:latest,MIGRATE_DATABASE_URL=promise-graph-migrate-database-url:latest"
   ```

6. With `UPDATE_SECRETS=1`, it destroys the old secret versions, only after the deploy works (see step 8).
7. It prints the service URL and `Open the app: <NEXT_PUBLIC_APP_URL>`. If `NEXT_PUBLIC_APP_URL` is not a URL of the service, it prints a `gcloud run services update … --update-env-vars NEXT_PUBLIC_APP_URL=…` command and exits with status 3. Run that command. The update makes a new revision without a new build.

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
3. Open `NEXT_PUBLIC_APP_URL`. The graph of your own Larkspur copy opens with no sign-in. Open the URL in a private window: you get a second, separate copy. Give this URL to the judges.
4. Open the account menu at the top right, select **Profile**, and upload a photo. It shows in the top bar at once. In the console, **Cloud Storage → Buckets → promise-graph-avatars** lists it under `avatars/`.

## 8. Deploy again

- After a code change, run `scripts/deploy-cloud-run.sh` again with the same values. It keeps the stored secrets.
- To change a secret, run it with `UPDATE_SECRETS=1`. It adds a new version of each secret. After the deploy works, it destroys the older versions, so the project keeps 3 active versions (4 with Google sign-in), under the free 6. When the deploy fails, it destroys nothing. When it cannot list the versions, it stops with status 4; then destroy the old versions in the console (**Security → Secret Manager**).
- To change only `NEXT_PUBLIC_APP_URL` (or `GOOGLE_CLIENT_ID` with Google sign-in), use `gcloud run services update promise-graph --region asia-southeast1 --update-env-vars KEY=value`. No build is needed.

## 9. Stay inside the free tier

- Keep `--min-instances 0` and the default CPU throttling. Cloud Run then bills only while a request runs.
- Each deploy stores a new image in Artifact Registry, and the free storage is 0.5 GB. Delete old images after a few deploys: in the console, open **Artifact Registry → cloud-run-source-deploy → promise-graph** and delete all but the newest. Or set a cleanup policy there that keeps the 2 newest versions.
- Cloud Build gets 2,500 free build-minutes a month; one build takes about 5 minutes.
- Keep 3 secrets (4 with Google sign-in) with one active version each.
- Keep the photo bucket in `us-central1`, `us-east1` or `us-west1` with Standard storage. A new photo deletes the old object, Remove photo deletes it, and soft delete is off, so the bucket holds one small object for each person with a photo.
- Do not add an uptime monitor: Neon then sleeps after 5 minutes, and its 100 CU-hours last the month.
- Check **Billing → Reports** once a week.

## Optional: Google sign-in (only for AUTH_MODE=google)

Do this only when people must sign in with Google instead of the demo copy.

1. In the Cloud console, go to **APIs & Services → OAuth consent screen**. Select **External**. Fill in the app name and your email. Add the scopes `openid`, `email` and `profile`. Set the publishing status to **In production**. In **Testing**, only the listed test users can sign in.
2. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**. Select **Web application**.
3. Under **Authorized redirect URIs**, add `<NEXT_PUBLIC_APP_URL>/api/auth/google/callback`, for example `https://promise-graph-123456789012.asia-southeast1.run.app/api/auth/google/callback`.
4. Select **Create**. Copy the client ID (`GOOGLE_CLIENT_ID`) and the client secret (`GOOGLE_CLIENT_SECRET`).
5. Add three lines to the env file of step 6, then run the script again:

   ```sh
   export AUTH_MODE=google
   export GOOGLE_CLIENT_ID=<client id>
   export GOOGLE_CLIENT_SECRET=<client secret>
   ```

   The script then stores the client secret, sets `GOOGLE_CLIENT_ID`, and prints the OAuth redirect URI. The first sign-in of each Google account builds its Larkspur sandbox.

## Demo sandboxes: size, limit and cleanup

Each visitor's copy is a full Larkspur project in its own workspace, owned by an anonymous person named Demo visitor.

- **Size.** One new copy writes 43 rows (person, workspace, project, 5 members, 7 teams, 5 team places, 6 Queue items, 4 change requests, 9 comments, 1 commit, 1 share) and takes about 28 KB on PostgreSQL, indexes included (measured: 100 copies grew the database by 2.9 MB). The empty schema takes about 9 MB. So 1 GB (the Neon Free storage) holds about 35,000 copies before visitors add their own changes.
- **When a copy is made.** Only when a browser opens a page with no session: a `GET` that asks for HTML. `HEAD`, `/api/health`, `/mcp`, files and prefetches make nothing. When the cookie does not come back on the next request (cookies off, a frame inside another site), the visitor sees a short page about cookies and no more copies are made. A user agent that names a bot, crawler, spider, preview, Slackbot, facebookexternalhit, WhatsApp, TelegramBot, Discordbot or curl gets a read-only welcome page that links to the app, so link previews make nothing.
- **Limit.** One address (the last `X-Forwarded-For` value, which Cloud Run appends) gets at most 30 new copies an hour; past it, the welcome page says to try again later.
- **Cookie.** The session cookie lasts 30 days (`HttpOnly`, `Secure`, `SameSite=Lax`) and is not renewed. After 30 days nobody can open that copy again. **Start over** in the account menu makes a new person and a fresh copy; the old copy stays until the cleanup.
- **Cleanup.** `scripts/delete-demo-sandboxes.mjs` deletes the copies made more than N days ago (default 30, the cookie lifetime, so it never deletes a copy that a visitor can still open). It is a script that you run, not a cron job. Without `--apply` it only counts:

  ```sh
  (source ~/.config/promise-graph/deploy.env && DATABASE_URL="$MIGRATE_DATABASE_URL" node scripts/delete-demo-sandboxes.mjs --days 30)
  (source ~/.config/promise-graph/deploy.env && DATABASE_URL="$MIGRATE_DATABASE_URL" AVATAR_BUCKET=promise-graph-avatars node scripts/delete-demo-sandboxes.mjs --days 30 --apply)
  ```

  A visitor can also set a profile photo and create personal keys in their copy. The script deletes their keys with the copy. With `AVATAR_BUCKET`, it then deletes their photos from the bucket with `gcloud storage rm` (signed in as in step 3). Without `AVATAR_BUCKET`, or when gcloud fails, it prints `demo_photos_left` with the object keys it left; delete them in the console (**Cloud Storage → Buckets → promise-graph-avatars → avatars/**).

  A smaller `--days` also deletes copies whose cookie still works: their visitor then gets a new copy on the next visit.

## Deploy from a tag

After the first deploy by hand (steps 1 to 7), GitHub Actions can deploy each tag that starts with `v`. The workflow `.github/workflows/deploy.yml` runs the same checks as CI. When they pass, it builds the `Dockerfile`, pushes the image to Artifact Registry and deploys it. It changes only the image: the service keeps its env vars, secrets, service account and limits. GitHub signs in to Google through Workload Identity Federation, so no service account key exists anywhere.

Set it up once:

1. Sign in to gcloud as the project owner (step 3) and to the GitHub CLI (`gh auth login`). Then run the setup script from the repository root:

   ```sh
   GCP_PROJECT_ID=promise-graph GITHUB_REPOSITORY=PhucLuu-091005/cybernetics scripts/setup-github-cd.sh
   ```

   The script does these things. A second run creates nothing new.
   - It creates the Docker repository `promise-graph` in `asia-southeast1`, with a cleanup policy that keeps the 3 newest images.
   - It creates the account `promise-graph-deployer`. The account gets `roles/run.developer` on the service, `roles/artifactregistry.writer` on the repository and `roles/iam.serviceAccountUser` on the runtime account. It gets no other role.
   - It reads the ids of the repository and of its owner with `gh api repos/PhucLuu-091005/cybernetics --jq '.id,.owner.id'` (today `1415634185` and `187116949`). Without `gh`, set them yourself in `GITHUB_REPOSITORY_ID` and `GITHUB_OWNER_ID`.
   - It creates a Workload Identity pool and an OIDC provider for GitHub. The provider accepts only a job of that repository id and owner id, on a tag that starts with `v`, in the environment `production`. Google checks the ids and not the name, so after a rename, a new repository with the old name gets no access.

2. The script prints two `gh variable set` commands. Run them. They set the repository variables `GCP_WIF_PROVIDER` and `GCP_DEPLOYER_SA`. Neither value is secret, so they are variables, not secrets.

Deploy:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

Watch the run in the **Actions** tab or with `gh run watch`. The job summary shows the service URL after `/api/health` returns `ok`. A failed check stops the run before the deploy. After a deploy works, the last job creates a GitHub release for the tag, with notes made from the merged pull requests. A second deploy of the same tag keeps the release it has.

One run waits for the run before it, so an older tag never deploys after a newer one.

To roll back, deploy an earlier tag again. Start the workflow from that tag:

```sh
gh workflow run deploy.yml --ref v0.1.0 -f tag=v0.1.0
```

Do not roll back to an old revision in the Cloud Run console. The cleanup policy keeps only the 3 newest images, so the image of an old revision can be gone. The workflow builds the image of the tag again.

Protect the tags. Anyone who can push a `v*` tag can deploy. In **Settings → Rules → Rulesets**, add a tag ruleset:

1. Target the tags that match `v*`.
2. Select **Restrict creations**, **Restrict updates** and **Restrict deletions**.
3. Add only the repository admin (the owner) to the bypass list.

The deploy job runs in the GitHub environment `production`, and Google gives a token only to a job in that environment. In **Settings → Environments → production**, you can also:

- set **Deployment branches and tags** to **Selected branches and tags** with the tag rule `v*`;
- add a required reviewer, so that each deploy waits for an approval.

GitHub makes the environment at the first run. To change a secret or an env var, use `scripts/deploy-cloud-run.sh` or `gcloud run services update` as in step 8.

The free limits that matter here:

- GitHub Actions: a public repository gets free minutes with no limit. A private repository on the Free plan gets 2,000 minutes a month. This repository is public. One tag uses about 20 to 30 minutes, because the checks, the end-to-end tests and the image build each take a runner.
- Artifact Registry: 0.5 GB of storage for the whole project. The cleanup policy keeps the 3 newest images in `promise-graph` and deletes the others. Artifact Registry runs the policy about once a day. The images of the deploys by hand stay in `cloud-run-source-deploy`, so delete them there (step 9).

## Troubleshooting

- **The build fails with a permission error on the service account.** Cloud Build builds the image as the default compute service account. Some new projects do not give that account the build role. Run:

  ```sh
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member "serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
    --role roles/run.builder
  ```

- **`migrations_failed` with code `28P01` (password authentication failed).** The password in a Neon URL is old, for example after a password reset in Neon. Copy both URLs again (step 1), put them in the env file, then run the script with `UPDATE_SECRETS=1`.
- **The start stops with `"event": "photo_config_invalid"`.** `AVATAR_STORE` is `gcs` and `AVATAR_BUCKET` is empty or not a bucket name. Run the script again, or set `AVATAR_BUCKET` with `gcloud run services update`.
- **A photo upload fails with "Internal error".** The runtime account cannot write to the bucket. Check that `promise-graph-runtime@…` has `Storage Object User` on the bucket (**Cloud Storage → Buckets → promise-graph-avatars → Permissions**), or run the script again.
- **Google says `redirect_uri_mismatch` (Google sign-in only).** The redirect URI in the OAuth client must equal `NEXT_PUBLIC_APP_URL` followed by `/api/auth/google/callback`.
- **The page says "Production requires HTTPS".** `NEXT_PUBLIC_APP_URL` starts with `http://`. Set it to the `https://` service URL.
- **A request fails once after a long idle time.** Neon closes idle connections when it stops. The app drops a closed connection and opens a new one, so a reload works.
