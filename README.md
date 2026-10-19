# Promise Graph

Promise Graph is an event tracker for a whole project. Each team has rows of work items, and each row shows its events on a time line. The graph shows what happened, which work led to which work across teams, and why plans changed.

Main is read-only. People and their agents add events and work items to a Queue. A person places them in a change request, and a person with the Merge right merges it into Main. The app never calls an AI model and holds no provider key.

To put the app online, follow [docs/deploy-cloud-run-neon.md](docs/deploy-cloud-run-neon.md) (Google Cloud Run and Neon). The hosted app opens with no login: each visitor gets their own copy of the demo project (`AUTH_MODE=demo`).

After the first deploy, each pushed `v*` tag deploys itself through GitHub Actions: see [Deploy from a tag](docs/deploy-cloud-run-neon.md#deploy-from-a-tag).

To release: bump package.json version, merge, then tag v<version>. The deploy fails when the tag and package.json differ. MCP `serverInfo` and `/api/health` report this version.

![The Larkspur demo project on Main: teams, work items, events, milestones and the legend](docs/screenshots/tracker-main.png)

## Main screens

- **Graph.** Teams, work items, events, milestones and planned finish dates on one time line. Click a row for its details. Search, filters, focus, hide, zoom and full view change only your view.
- **Change request.** One page per change request: the Changes list, Before and After, and the Queue when you edit. A person with the Merge right merges it or requests changes, and picks Main or the change request for each clash.
- **History.** Every merge into Main, and the cancelled change requests with their reasons.
- **New changes.** The screen does not change by itself when another person or an agent writes. A quiet line in the bar under the top bar says "New changes · Refresh" (or "Main changed", "2 new change requests"). Click **Refresh** to see them. Your own changes show at once.
- **Members.** The people of the project, their teams and their grants. The project lead edits them.
- **Settings.** The project facts and the agent tokens.
- **Profile.** Your photo and your personal keys for every project (account menu, **Profile**).

Your first visit (or your first sign-in in `local` and `google` modes) creates a private sandbox: the fictional Larkspur Capital project with 7 teams, a Queue, a Main history of 10 merged change requests that builds the project from empty, and 3 open change requests ([fixtures/README.md](fixtures/README.md)). The story covers five weeks and ends just before the moment you open it, so the T line and the statuses follow the real clock. The first visit opens a short intro that names the app and its two paths, Explore the demo and Connect an agent; **About this demo** in the account menu shows it again. An older sandbox keeps its data; **Start over** in the account menu asks first, then gives a fresh copy with the new story. The **Demo** select at the top right changes who you work as and shows each person's role; while you act as someone, every page, Profile and its photo included, is that person's. The graph opens with Comfortable rows and every team open. The full behaviour is in the [spec](docs/superpowers/specs/2026-10-16-event-tracker-design.md).

## Run it locally

You need Node.js 24 and Docker. You do not need a global pnpm.

1. Start PostgreSQL 17 on `127.0.0.1:55432`:

   ```sh
   docker compose up -d postgres
   ```

2. Copy the environment file. Put the output of `openssl rand -hex 32` in `SESSION_SECRET`. The file explains each variable.

   ```sh
   cp .env.example .env.local
   ```

3. Install the dependencies and apply the migrations:

   ```sh
   npx pnpm@11.25.0 install --frozen-lockfile
   node --env-file=.env.local scripts/migrate.mjs
   ```

4. Start the app and open <http://localhost:3000>:

   ```sh
   npx pnpm@11.25.0 dev
   ```

   With `AUTH_MODE=local`, **Continue (local dev)** signs you in without Google. `/signin?label=<label>` signs in another local user with its own sandbox, for example `/signin?label=lan-test`.

## Run the checks

| Command | Checks |
|---|---|
| `npx pnpm@11.25.0 typecheck` | TypeScript |
| `npx pnpm@11.25.0 lint` | ESLint |
| `npx pnpm@11.25.0 format:check` | Prettier |
| `npx pnpm@11.25.0 check:providers` | No model SDK and no provider key |
| `TEST_DATABASE_URL=<admin url> npx pnpm@11.25.0 test` | Unit and integration tests. Without `TEST_DATABASE_URL`, the integration tests skip. |
| `TEST_DATABASE_URL=<admin url> E2E_PORT=3300 npx pnpm@11.25.0 test:e2e` | Playwright. Stop any dev server in the same checkout first, because both write to `.next`. |

The admin URL for the local database is `postgresql://promise_graph:local-development-only@127.0.0.1:55432/promise_graph`. Each test file makes its own throwaway database.

## Connect an agent

Your agent (for example Claude Code) connects to `/mcp` with a key. A project token (Settings) works in one project; a personal key (Profile) works in every project you belong to. The agent acts as you, inside the permissions of the key.

1. In a project, open **Settings** and create a token. Tick the permissions it needs. Copy the secret: the app shows it once.
2. Add the server to your MCP client:

   ```json
   {"mcpServers":{"promise-graph":{"type":"http","url":"https://<host>/mcp","headers":{"Authorization":"Bearer inv_..."}}}}
   ```

3. Ask the agent to list its tools, then press **Check again** in Settings to see its last call.

The tools and their permissions are in [docs/mcp-agent-recipe.md](docs/mcp-agent-recipe.md).

## Known limits

- **No sync.** Email and Slack are not connected. People add events with **Add**, and agents add them through MCP.
- **Invites send no email.** An invited person sees the project after they sign in with Google with the invited email. Tell them yourself.
- **Demo members.** The 5 demo members live only in your sandbox.
- **No revert.** A merge into Main is final.
- **One instance.** The rate limits (300 reads and 120 writes a minute for each user, 600 checks for new changes a minute for each user, 60 calls a minute for each token) live in process memory, so the app runs as one instance.
- **Cold starts.** On the free deploy, Cloud Run and Neon stop when idle. The first request after an idle time waits a few seconds.
