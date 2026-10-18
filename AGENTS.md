<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Agent guide: event tracker (Promise Graph)

Rules for coding agents in this repository. Read this file before you change anything. `CLAUDE.md` imports it, so Claude Code and other agents follow the same rules. The block above belongs to Next.js: `next dev` writes it, so keep it as it is at the top.

## What the app is

Promise Graph is an event tracker for a whole project. Each team has rows of work items, and each row shows its events (Message, Task, Handoff, Decision, Meeting, Delivery, Issue, Done) on a time line, with milestones, planned finish dates and handoffs between teams. Main is read-only. People and their agents add events and work items to a Queue; a person places them through a change request; the owner of Main reviews, resolves clashes and merges. The app never calls an AI model. The full behaviour is in the spec (see "Docs to keep current").

## Stack and where things live

Next.js 16 (App Router), React 19, TypeScript, PostgreSQL 17 with Drizzle, Zod, Vitest, Playwright, plain CSS with tokens (Tailwind 4 is installed but the UI uses CSS classes).

| Path | What it holds |
|---|---|
| `src/tracker/` | Pure shared model: types, Zod schemas, ops and replay, clashes, status, layout, search, filter, focus, offsets, time. No React, no Node APIs, no I/O. The browser and the server run the same code. |
| `src/components/tracker/` | Tracker UI: `TrackerScreen`, `TopBar`, `ContextBar`, `QueuePanel`, `TrackerGraph`, `Search`, `Pops`, `Drawers`, `Modals`, `ReviewScreen`, `icons.tsx`, `tracker.css`, `review.css`. Pure UI helpers (`view-state.ts`, `drag.ts`, `team.ts`, `pending.ts`) have unit tests. |
| `src/components/shell/` | Rail, project switcher, theme toggle, popover hook. |
| `src/server/tracker/` | Tracker use cases, permissions (`access.ts`), store, read model, Larkspur seed (`seed/larkspur.ts`). |
| `src/server/` (other) | `db/` (Drizzle schema, migrations, client), `http/` (route helper, sessions, rate limits, scopes), `domain/` (projects, tokens), `mcp/` (MCP server and tools). |
| `src/app/` | Routes. Pages under `(app)/projects/[id]/` (`graph`, `changes/[num]`, `settings`). REST under `api/v1/projects/[projectId]/tracker/**`. MCP endpoint at `mcp/route.ts`. Global CSS: `globals.css`, `shell.css`. |
| `tests/` | `unit/` (pure code), `integration/` (real Postgres), `e2e/` (Playwright), `support/` (test databases and fixtures). |
| `docs/` | Spec, plans, design option pages (`docs/design/`), design system, MCP recipe, README screenshots. |

## Skills

The repository has 4 skills in `.claude/skills/`. Each one holds the steps and a script for a job that every task repeats. Use them before you write the same steps by hand.

| Skill | Use it to |
|---|---|
| `et-worktree-setup` | Create the worktree, branch, database, `.env.local` and port of a task, and apply the migrations. |
| `et-gates` | Run every gate with real exit codes and the test counts. |
| `et-ui-qa` | Take light and dark screenshots at 1440 px and 390 px, and measure scroll, dashed lines and page errors. |
| `et-option-page` | Build an HTML option page for a question that the owner decides. |

## Commands

pnpm is not on PATH. Call the binaries in `node_modules/.bin` directly:

```sh
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
./node_modules/.bin/prettier --check .
./node_modules/.bin/vitest run
./node_modules/.bin/playwright test
./node_modules/.bin/next dev --webpack --hostname localhost --port <port>
```

- Clean install (for example before `next build`): `npx -y pnpm@latest install --frozen-lockfile`.
- A copied or linked `node_modules` breaks the Turbopack build. Use a clean install to check `next build`. Use `next dev --webpack` for a dev server.
- The provider check: `node scripts/check-no-model-dependencies.mjs`. It fails when a model SDK or provider key appears.

## Local Postgres

- One Docker container serves every worktree: `cybernetics-pg` on `127.0.0.1:55432`, user `promise_graph`, password `local-development-only`.
- Give each worktree its own database. Do not use a database that another worktree or the owner's dev server uses (for example `pg_et`).

```sh
docker exec cybernetics-pg createdb -U promise_graph pg_<task>
```

- Put it in the worktree's own `.env.local` (start from `.env.example`): `DATABASE_URL=postgresql://promise_graph:local-development-only@127.0.0.1:55432/pg_<task>`, `AUTH_MODE=local`, `NEXT_PUBLIC_APP_URL=http://localhost:<port>`, and a new `SESSION_SECRET` from `openssl rand -hex 32`. Never copy a secret into a commit or a report.
- Apply the migrations: `node --env-file=.env.local scripts/migrate.mjs`.
- Tests make their own throwaway databases (`pg_test_*`, `pg_e2e_*`) from `TEST_DATABASE_URL` and drop them at the end.

## Gates

Run every gate before you report work as done. Run them in your own worktree, never in the owner's live checkout. Capture the real exit code of each command, then read its summary line.

```sh
LOG=<your scratch dir>/gates; mkdir -p "$LOG"
B=./node_modules/.bin
ADMIN=postgresql://promise_graph:local-development-only@127.0.0.1:55432/promise_graph
$B/tsc --noEmit > "$LOG/tsc.log" 2>&1; echo "tsc rc=$?"
$B/eslint . > "$LOG/eslint.log" 2>&1; echo "eslint rc=$?"
$B/prettier --check . > "$LOG/prettier.log" 2>&1; echo "prettier rc=$?"
node scripts/check-no-model-dependencies.mjs > "$LOG/providers.log" 2>&1; echo "providers rc=$?"
TEST_DATABASE_URL=$ADMIN $B/vitest run > "$LOG/vitest.log" 2>&1; echo "vitest rc=$?"
TEST_DATABASE_URL=$ADMIN E2E_PORT=<free port> $B/playwright test > "$LOG/e2e.log" 2>&1; echo "e2e rc=$?"
TEST_DATABASE_URL=$ADMIN E2E_PORT=<free port> $B/playwright test -c playwright.demo.config.ts > "$LOG/e2e-demo.log" 2>&1; echo "e2e-demo rc=$?"
```

- Never pipe a gate into `tail` or `grep` before you take `$?`. The pipe returns the status of the last command, so a failed suite reads as green.
- Read the summary: Vitest prints `Test Files ... passed` and `Tests ... passed`; Playwright prints `N passed` and no `failed`. Report the counts.
- Without `TEST_DATABASE_URL`, the integration tests skip. A green run without it proves nothing about the database.
- Playwright starts its own `next dev` on `E2E_PORT` (default 3300) and writes to `.next`. Never run it in a worktree where a dev server runs, because both use the same `.next`. Use a separate detached worktree for e2e when a dev server must keep running.
- Pick a free port first: `lsof -nP -iTCP:<port> -sTCP:LISTEN` must print nothing. The owner's servers use some ports (3100 for the `dirb` worktree, 3200 for the event tracker demo; 3310 belongs to another app). Check the ledger for the ports that other tasks use.
- If Chromium is missing: `./node_modules/.bin/playwright install chromium`.

## Worktrees

Do each task in its own git worktree. Never edit files, switch branches, merge or run gates in the owner's live checkout; the owner may run a dev server there.

```sh
git -C <base checkout> worktree add -b phucluu/<task> <scratch dir>/<task> phucluu/event-tracker
cp -cR <base checkout>/node_modules <scratch dir>/<task>/
```

- Give the worktree its own `.env.local`, database and port (see above).
- For a gate run on a commit, use a detached worktree: `git worktree add --detach <dir> <ref>`, run there, then `git worktree remove --force <dir>`.
- Never touch another task's worktree, branch, database or server.

## Git

- Never push and never open a pull request until the owner checks the work. All event tracker branches are local only.
- Never add `Co-Authored-By`, "Generated with" or any other AI attribution to a commit or a message in this repository.
- Commit style: `type: summary` in lower case, for example `feat: handoff list closes on Tab`, `fix: ...`, `docs: ...`, `test: ...`, `style: ...`, `refactor: ...`.
- Commit on your task branch. The controller merges task branches into `phucluu/event-tracker`.
- Leave `node_modules` (a symbolic link in worktrees) and `.env.local` out of every commit.

## Process safety

- Never run `pkill`, `killall`, or `kill` with a name or a pattern. On 17 October 2026 a `pkill -f` killed every app on the owner's Mac, Docker included.
- Stop only the processes that you started. Keep their PIDs. To stop your own server: `lsof -nP -iTCP:<your port> -sTCP:LISTEN -t` gives the PID; check that it is yours, then `kill <pid>`.
- Never stop the owner's dev servers or another agent's servers.

## Code style

- Match the code around you: names, file layout, CSS class style, test style.
- Write very few comments. Write a comment only for a reason that the code cannot show (why, a trade-off, a constraint). Never describe what the next line does.
- Test first: write a failing test, then the code. Pure logic goes in `src/tracker/` or a pure helper with a Vitest unit test. Server rules get an integration test. Screens and flows get a Playwright test.
- Validate every write with the Zod schemas in `src/tracker/schemas.ts`. Keep `src/tracker/` free of React, Node APIs and I/O.
- Prettier: single quotes, print width 100. ESLint: `eslint-config-next` (Core Web Vitals and TypeScript) with `eslint-config-prettier`.

## UI rules

- Follow the design system: [docs/design-system.md](docs/design-system.md), with the visual reference [docs/design/design-system.html](docs/design/design-system.html). Use the tokens. Do not add a colour, radius, shadow or font size outside them.
- The hard rules: no dashed or dotted lines; yellow (C2) is the only change mark, never pink or violet; no coloured edge stripes; no status colour for selection; no connector lines on the graph; few cards (the rail and lists use bold text and hairlines); plain English UI words.
- Decide a visual question with an HTML option page before you build it:
  1. Put a single self-contained file in `docs/design/` named `YYYY-MM-DD-<topic>-options.html`. It must open from the file system.
  2. Draw each option on the real Larkspur data (`src/server/tracker/seed/larkspur.ts`), in light and dark.
  3. Recommend one option and say why.
  4. Write the explanation on the page in Vietnamese for the owner. Keep the app text inside the frames in English, as the app is.
  5. Give the owner the file path (not an Artifact link) and ask. Build only after the owner chooses.
- Check every UI change in a browser: light, dark and 390 px width, with no horizontal page scroll. Take screenshots into your scratch directory and look at them.

## Owner communication

- Write to the owner in Vietnamese, in plain, short sentences. Start each reply with `✓ `.
- Ask one clear question at a time, with options when you can.
- Say what you ran and the real results. Never say that a gate passed if you did not run it.

## Docs to keep current

| File | Update it when |
|---|---|
| `docs/superpowers/specs/2026-10-16-event-tracker-design.md` | The owner rules a change of behaviour or look. Edit the decision in place. |
| `docs/superpowers/plans/2026-10-16-event-tracker.md` | The task list changes. |
| `.superpowers/sdd/2026-10-16-event-tracker/progress.md` | After each task, review or ruling: one line with the branch, commits, gate counts, and each ruling as "Ruling: <decision>, why: <reason>, cost if wrong: <cost>". The folder is gitignored and lives in the controller's checkout; task briefs and reports sit next to the ledger. |
| `docs/design-system.md` and `docs/design/design-system.html` | A token, a component or a graph mark changes. |
| `README.md` | A user-visible flow changes. Take the screenshots again when the UI changes. |
| `docs/mcp-agent-recipe.md` | An MCP tool or scope changes. |
