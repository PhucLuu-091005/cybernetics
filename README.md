# Promise Graph

Promise Graph is an event tracker for a whole project. It shows what happened at every step, which work led to which work across teams, and why plans changed.

People and their agents add events and work items to a Queue. In a change request, a person drags them onto the graph. Main is read-only: every change goes through a change request, and the owner of Main merges it.

![The Larkspur demo project on Main: the read-only notice, teams, work items, events, milestones and their chips](docs/screenshots/tracker-main.png)

## What it does

- **Events.** An event is a Message, Task, Handoff, Decision, Meeting, Delivery, Issue or Done. Each event sits on the row of one work item.
- **Work items and teams.** Each work item has one row under its team. A work item can have a parent and can lead from other work items. It is done when it has a Done event. The eye buttons hide a row or a whole team for you only. A hidden row leaves no line on the graph. A row whose own parent or source is hidden shows a small branch chip. Press the chip to show that row again.
- **Milestones.** A milestone has 5 statuses: Planned, Finished early, Finished on time, Late and Finished late. It is done when all its work items are done. Its circle on the milestone line shows the status.
- **Milestone chips and ticks.** Each work item in a milestone shows a chip with the milestone name at the right of its row. The row also shows a short tick at the milestone date while that date has not passed, or when the row makes the milestone late. The chip and the tick are red when an open row makes the milestone late, and amber when the row finished after the milestone date. A click on a chip or a tick opens the milestone.
- **Planned finish.** Each work item has a Planned finish date and the same 5 statuses. To move a Planned finish or a milestone date, you must write a reason. The app keeps the first date and every move: who, when, from, to and why.
- **Queue.** New events and work items wait in the Queue. People add them with **Add**, and agents add them through MCP. The Queue shows only in a change request that you edit. Drag a card onto a work item or a team to place it. Every drag also has a click way. The Queue toggle hides the Queue, so the graph gets the full width.
- **Main is read-only.** On Main, the graph and its pops show information only: no drag that changes the graph, no edit buttons. A notice at the top says so; **New change request** is in the bar above it. **Don't show again** hides the notice for you. A merged or closed change request and a change request that someone else edits are read-only too.
- **Search.** Type in **Search work items** at the top right. The search matches the title, the team and the people of each work item. Pick a result with the arrow keys and Enter, or with a click. The graph shows the row again if it is hidden, zooms to it and flashes it. The details panel opens: the status, the planned finish with every move and its reason, the start, the finish, the time spent in hours and days, the parent, the sources and all the events. A click on an event opens its pop on the graph.
- **Your own event positions.** Drag an event left or right to move its icon inside its day, for example to pull a stack apart. This works in every view, Main included. The position is yours only, stays after a reload, and never changes the event time. **Reset position** in the event pop puts it back.
- **Zoom.** The zoom buttons at the bottom right of the graph stretch the time line. Ctrl (or Cmd) and the mouse wheel also zoom. **Fit** shows the whole window again.
- **Change requests.** A change request is a Draft, Ready, Merged or Closed. It always shows the latest Main plus its own changes. **Share** gives a person Can edit or Can view. Everyone in the project can view every change request.
- **One editor at a time.** A person with Can edit presses **Ask to edit**. The current editor presses **Hand over** or **Not now**.
- **Ready.** **Mark as ready** locks the change request. The editor presses **Edit again** to unlock it.
- **Review.** The owner of Main reviews a ready change request on its own page: **Changes** (before and after, the reason of each date move, comments), **On the graph** (Before and After) and **Conversation**. The owner can merge it, request changes or close it.
- **Clashes.** A change clashes when Main took a different change on the same spot after the change request made its change. The owner picks Main or the change request for each clash. The merge records each pick.
- **History.** History lists every merge into Main, newest first, with **See changes** and **Open graph**.

The app never calls an AI model and holds no provider key.

| | |
|---|---|
| ![The details panel of the Go-live date: first planned 30 Sept, moved once to 15 Oct, with the reason and the events](docs/screenshots/date-moves.png) | ![Change request #5 with the Queue and its Changes drawer: an event from the Queue and a date move with its reason](docs/screenshots/change-request.png) |
| The details of a work item after a search: the status, the times, the first date, each move and its reason, and the events. | A change request with 2 changes. The second change moves a date and shows why. |
| ![The review of #3 with one clash with Main on the PG-203 name](docs/screenshots/review-clash.png) | ![Main history with the merges and the resolved clash](docs/screenshots/history.png) |
| The review page. **Merge into Main** stays off until the owner picks a version for the clash. | History records each merge and each resolved clash. |

<img src="docs/screenshots/phone.png" alt="The tracker at phone width: a change request with the Queue above the graph" width="300">

The screenshots come from a local development server on 16 October 2026, with the seeded sandbox and the light theme. The desktop shots use a 1440 x 900 viewport; the phone shot uses a 390 x 844 viewport.

The prototype is [docs/design/2026-10-16-event-tracker-v8.html](docs/design/2026-10-16-event-tracker-v8.html). The design is [docs/superpowers/specs/2026-10-16-event-tracker-design.md](docs/superpowers/specs/2026-10-16-event-tracker-design.md).

## Demo walkthrough

Your first sign-in creates a private sandbox: the fictional Larkspur Capital onboarding project with 7 teams, 2 milestones, a Queue and 4 change requests ([fixtures/README.md](fixtures/README.md)). The demo clock stands at 9 October 2026, 18:00 (Asia/Ho_Chi_Minh).

Use the **Demo** select at the top right to change who you work as. Minh Trần owns Main. Lan Phạm, Quang Nguyễn, Hà Đỗ and Khoa Lê are members. The select shows only in the demo project. In your own projects, you work as yourself.

Main opens with a notice that it is read-only. Press **×** to close it for now, or **Don't show again**.

1. Anyone: type "Go-live" in **Search work items** and pick Go-live date. The details panel shows the first date (30 Sept), the new date (15 Oct) and the reason.
2. Lan: press **New change request**, then **Create**. Drag the Queue event "Where is the root cause report…" onto Sync incident report.
3. Lan: search "PG-203" and pick it. In the details panel, press **Move the date**. Pick the date, write the reason, then press **Move the date**.
4. Lan: press **Share**, pick Khoa Lê with **Can edit**, then press **Add**.
5. Khoa: Lan's change request opens, and Lan is editing. Press **Ask to edit**.
6. Lan: the yellow row says that Khoa asks to edit. Press **Hand over**.
7. Khoa: drag the event "Scope call…" onto Dynamics CRM sync scope.
8. Khoa: press **Mark as ready**.
9. Minh: on #2, press **Review and merge**. Look at the Changes and On the graph tabs, then press **Merge into Main**.
10. Minh: open #3 by Quang. Its PG-203 name clashes with #2. Pick one version, then merge.
11. Minh: open #5 and read why the PG-203 date moves. Press **Request changes**. Then Khoa: press **Read**, then **Mark as ready** again.
12. Anyone: press **History**, then **See changes** on a merge.
13. Anyone: open a merged change request (**History**, **Open graph**). It is read-only history: no Queue, no drag and no edit buttons. Press **New change request** to change more.

[tests/e2e/tracker.spec.ts](tests/e2e/tracker.spec.ts) runs these 13 steps in a browser.

## Connect an agent

Your own agent (for example Claude Code) connects to `/mcp` with a project token. It reads the project and adds events and work items to the Queue. No tool changes Main: a person places each card through a change request, and the owner of Main merges it.

![Settings: the two agent permissions, the MCP snippet and a created token](docs/screenshots/agent-tokens.png)

1. Open **Settings** in a project and create a token. Keep both permissions: **Read the project** (`project:read`) and **Add to the Queue** (`queue:add`). Copy the secret; the app shows it once.
2. Add the server to your MCP client:

   ```json
   {"mcpServers":{"promise-graph":{"type":"http","url":"https://<host>/mcp","headers":{"Authorization":"Bearer inv_..."}}}}
   ```

3. Ask the agent to list its tools. Then press **Check again** in Settings. The **Last call** column of the token shows the time of that call.
4. Follow the recipe in [docs/mcp-agent-recipe.md](docs/mcp-agent-recipe.md):
   - `project:read`: `get_project`, `get_tracker`, `list_queue`, `list_change_requests`, `get_change_request`.
   - `queue:add`: `add_queue_event` and `add_queue_item`. A card that an agent adds shows an **Agent** chip in the Queue.

## Local setup

Requirements: Node.js 24, Docker. pnpm is not needed globally; the commands use `npx pnpm@11.25.0`.

1. Start PostgreSQL 17 on `127.0.0.1:55432`:

   ```sh
   docker compose up -d postgres
   ```

2. Copy the environment file and set a session secret:

   ```sh
   cp .env.example .env.local
   openssl rand -hex 32   # paste the output into SESSION_SECRET in .env.local
   ```

3. Install the dependencies and apply the migrations:

   ```sh
   npx pnpm@11.25.0 install --frozen-lockfile
   node --env-file=.env.local scripts/migrate.mjs
   ```

4. Start the app and open <http://localhost:3000>. With `AUTH_MODE=local`, **Continue (local dev)** signs you in without Google. `/signin?label=<label>` signs in a separate local user with its own sandbox. A label is 1 to 40 lowercase letters, digits or hyphens, for example `/signin?label=lan-test`. The sign-in page ignores any other label and uses the default local user.

   ```sh
   npx pnpm@11.25.0 dev
   ```

### Environment variables

| Variable | Value |
|---|---|
| `AUTH_MODE` | `google` in production. `local` works only on a loopback origin and only when `NODE_ENV` is not `production`. |
| `NEXT_PUBLIC_APP_URL` | The public origin, for example `https://promise-graph.onrender.com`. Production requires `https`. The server reads it at run time. |
| `SESSION_SECRET` | At least 32 bytes. It signs the session cookie. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The Google OAuth web client. Required when `AUTH_MODE=google`. |
| `DATABASE_URL` | The PostgreSQL connection URL. |

### Commands

| Command | Purpose |
|---|---|
| `npx pnpm@11.25.0 typecheck` | TypeScript check |
| `npx pnpm@11.25.0 lint` | ESLint |
| `TEST_DATABASE_URL=<admin url> npx pnpm@11.25.0 test` | Unit and integration tests. Each integration file creates and drops its own database. Without `TEST_DATABASE_URL`, the integration tests skip. |
| `npx pnpm@11.25.0 check:providers` | Fails if a model SDK, provider credential or analysis job kind appears |
| `TEST_DATABASE_URL=<admin url> E2E_PORT=3300 npx pnpm@11.25.0 test:e2e` | Playwright suite. It starts `next dev` on `E2E_PORT` (default 3300) against a throwaway `pg_e2e_*` database. Stop any dev server in the same checkout first, because both write to `.next`. |
| `npx pnpm@11.25.0 build` | Production build (Next.js 16, Turbopack, standalone output) |

## Deploy on Render (free plan)

[render.yaml](render.yaml) is a Render Blueprint. It declares one Docker web service (`plan: free`, health check `/api/health`) and one PostgreSQL 17 database (`plan: free`) in the Singapore region. The container applies pending migrations on each start, then starts the server. If a migration fails, the container stops and Render keeps the previous deploy.

**The tracker needs a fresh database.** Migration 0004 adds the tracker tables, and migration 0005 drops the old promise data (records, proposals and graph commits). An account seeds its sandbox only on its first sign-in. An account that signed in before the tracker therefore keeps a project with no tracker, and its graph page says "This project has no tracker yet." Before the first tracker deploy, point the service at an empty database. Each account then gets the Larkspur sandbox on its first sign-in.

On a deployment that already runs the promise version, delete the old database in the Render dashboard. Then sync the Blueprint, so that Render creates a new empty `promise-graph-db`, and deploy. For a new deployment, follow the steps below.

The free plan has two limits that affect the demo:

- A free web service sleeps after 15 minutes without traffic. The first request after that waits about one minute.
- A free database expires 30 days after creation. Render deletes it after a further 14 days. A workspace can have only one free database.

Do these steps in this order:

1. **Create the Google OAuth client.** In Google Cloud Console, go to **APIs & Services → Credentials → Create credentials → OAuth client ID**. Select **Web application**. Leave the redirect URI empty for now. Configure the consent screen with the scopes `openid`, `email` and `profile`, and set its publishing status to **In production**. In **Testing** status, only the listed test users can sign in. Keep the client ID and the client secret.
2. **Create the services from the Blueprint.** In the Render dashboard, select **New → Blueprint**, connect this repository and select the branch to deploy. Render reads `render.yaml` and creates an empty database. A database created on 16 October stays alive until about 15 November, which is after 22 October.
3. **Enter the prompted values.** Render asks for the three `sync: false` variables:
   - `NEXT_PUBLIC_APP_URL`: `https://<service>.onrender.com`. The service name in `render.yaml` is `promise-graph`. If Render adds a suffix, use the URL that the service page shows, and correct the variable after the first deploy.
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: the values from step 1.

   Render generates `SESSION_SECRET` and connects `DATABASE_URL` to the database over its private network. The database accepts no external connections (`ipAllowList: []`).
4. **Add the redirect URI.** In the Google OAuth client, add the authorized redirect URI `https://<service>.onrender.com/api/auth/google/callback`. It must equal `NEXT_PUBLIC_APP_URL` followed by `/api/auth/google/callback`.
5. **Deploy and check.** The service has `autoDeploy: false`, so start each deploy with **Manual Deploy**. Then check:
   - `https://<service>.onrender.com/api/health` returns `{"status":"ok"}`.
   - The deploy log shows `{"event":"migrations_applied",…}`.
   - **Continue with Google** signs you in and shows the Larkspur tracker. The first sign-in of each account builds its sandbox, so it takes longer than later sign-ins. If the callback page is reloaded after that, Google refuses the used code, and the page shows a link to start again.
6. **Keep the demo awake until 22 October.** Create a free monitor at [UptimeRobot](https://uptimerobot.com) (or a similar service): type HTTP(S), URL `https://<service>.onrender.com/api/health`, interval 10 minutes. One always-on free service uses about 744 of the 750 free instance hours in a 31-day month, so do not run a second free service in the same workspace.
7. **Walk through the demo.** Sign in with a Google account that has never signed in, and do the 13 steps of the [Demo walkthrough](#demo-walkthrough). Then connect a real agent with the MCP snippet and let it add one event to the Queue.

The app runs as one process because the rate limiter is in memory. Do not scale the service to more than one instance.

## Known limits

- **No sync.** Email and Slack are not connected. People add events with **Add**, and agents add them through MCP.
- **Demo members.** The 5 demo members live in your sandbox, and the **Demo** select switches between them. The app cannot invite real users by email.
- **No revert.** A merge into Main is final. The app has no revert or restore of Main.
- **Free hosting.** The free web service sleeps after 15 minutes without traffic, and the free database expires 30 days after creation. See [Deploy on Render](#deploy-on-render-free-plan).
- **One instance.** Rate limits (300 reads and 120 writes a minute for each user, 60 calls a minute for each token) are kept in process memory.
