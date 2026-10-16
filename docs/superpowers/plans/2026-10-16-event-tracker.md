# Event tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the promise model with the event tracker and change requests described in the spec, on a working Next.js app, by 2026-10-19 23:59 (Asia/Ho_Chi_Minh).

**Architecture:** A new vertical slice: pure shared code in `src/tracker/` (model, operations, clashes, statuses, layout), server use cases in `src/server/tracker/` on new `tracker_*` tables, REST routes under `/api/v1/projects/[projectId]/tracker`, React UI in `src/components/tracker/`. A change request is an ordered operation list; Main is a base snapshot plus merged operation lists. The browser replays with the same pure code. The promise subsystems are deleted at the end.

**Tech Stack:** Next.js 16 (webpack dev), React 19, TypeScript 5.9, Zod 4, Drizzle ORM on PostgreSQL, Vitest 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-event-tracker-design.md`. Reference prototype: `docs/design/2026-10-16-event-tracker-v8.html` (copy its logic and look). Codebase facts: `docs/superpowers/specs/2026-10-16-event-tracker-codebase-map.md`.

## Global Constraints

- Worktree: `/private/tmp/claude-501/-Users-latotheluu-orca-workspaces-cybernetics-tropicbird/530c3946-61da-4c51-8971-f4d3df66dbcc/scratchpad/et` (or the task worktree named in the dispatch). Branch work only; never push; never touch the `dirb` worktree or port 3100.
- Commits: conventional prefixes (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). Never add `Co-Authored-By` or any AI attribution line.
- Tools: `./node_modules/.bin/tsc`, `eslint`, `prettier`, `vitest`, `playwright` (pnpm is not on PATH).
- Integration tests: `TEST_DATABASE_URL=postgresql://promise_graph:local-development-only@127.0.0.1:55432/promise_graph`.
- Dev database for manual checks: `pg_et` (already in `.env.local`), dev server port 3200. E2E: `E2E_PORT=3300` or higher, never 3100.
- Gates: capture the real exit code (`cmd > log 2>&1; echo $?`) and read the summary line.
- Code comments: as few as possible; only the WHY.
- UI copy: English, plain words, no git words in the UI except "Merge" and "change request". Keep the prototype's wording.
- The prototype is the source of truth for behavior and look when the spec is silent.
- Dates: `YYYY-MM-DD` in the project time zone (default `Asia/Ho_Chi_Minh`); instants: ISO 8601 with offset.
- No new runtime dependencies without a reason in the report.

## Review Focus

1. A change made after the editor saw a newer Main value must not clash; an identical change must drop silently (spec 2.17).
2. Every CR write checks the acting member against the single-editor lock and the CR status inside one transaction; the wrong member gets 403 (spec 3.6).
3. A Planned finish or milestone date move with an empty or whitespace reason is rejected by the pure op, the server and the UI.
4. Day boundaries: statuses compare calendar days in the project time zone, not UTC (an item planned for 2026-10-06 and done at 2026-10-06T23:30+07:00 is on time).
5. Phone width 390 px: no horizontal page scroll on the graph screen or the review screen.

## Execution waves

- Wave 1: Task 1.
- Wave 2: Task 2 and Task 3 in parallel (separate worktrees, disjoint files), then merge.
- Wave 3: Task 4 and Task 5 in parallel, then merge.
- Wave 4: Task 6 and Task 7 in parallel, then merge.
- Wave 5: Task 8. Wave 6: Task 9. Then the final whole-branch review.

---

### Task 1: Pure tracker core (model, operations, clashes, statuses, descriptions)

**Files:**
- Create: `src/tracker/model.ts`, `src/tracker/schemas.ts`, `src/tracker/time.ts`, `src/tracker/ops.ts`, `src/tracker/clash.ts`, `src/tracker/status.ts`, `src/tracker/describe.ts`, `src/tracker/payload.ts`, `src/tracker/index.ts`
- Create tests: `tests/unit/tracker/ops.test.ts`, `tests/unit/tracker/clash.test.ts`, `tests/unit/tracker/status.test.ts`, `tests/unit/tracker/describe.test.ts`
- Create test support: `tests/support/tracker-fixture.ts` (a small state builder plus the Larkspur demo state, see below)

**Interfaces (produce exactly these names):**
- `model.ts`: the types of spec 3.2 plus `EventKind`, `EVENT_KINDS`, `KIND_LABEL`, `Status = 'planned'|'early'|'ontime'|'late'|'flate'`, `STATUS_LABEL`.
- `schemas.ts`: Zod schemas `TrackerStateSchema`, `OpSchema`, `QueueEventInputSchema`, `QueueItemInputSchema`, and one schema per op argument shape.
- `time.ts`: `dayOf(instant, timeZone): string`, `addDays(date, n): string`, `compareDay(a, b): number`, `startOfDayInstant(date, timeZone): string`, `formatDay(date)`, `formatStamp(instant, timeZone)` ("9 Oct 18:00" style, months `Jan Feb Mar Apr May Jun Jul Aug Sept Oct Nov Dec` as the prototype).
- `ops.ts`: `type Op`, `type OpName`, `type OpEntry = {i, item, change, before, after, icon?, why?, skipped?}`, `class OpError`, `applyOp(state, op): {state, entry}` (pure: returns a new state; never mutates the input), `replayOps(base, ops): {state, entries, marks}` with `marks = {workItems: Set<string>, events: Set<string>, milestones: Set<string>, dates: Set<string>}`, `keysOf(op): string[]`, `sameOp(x, y): boolean`, `initialState(base, queueRows)`.
- `clash.ts`: `type Commit = {rev, crId, crNum, mergedBy, mergedAt, ops, resolutions}`, `type Clash = {key, index, x, y, commit}`, `newerOps(commits, fromRev)`, `clashesOf(crOps, commits)`, `liveOps(crOps, commits, picks?)`, `mainState(base, queueRows, commits, upto?)`, `crState(base, queueRows, commits, cr)`.
- `status.ts`: `itemInfo(item, events)` (`{done, finishedAt, start, end}` per prototype `info`), `itemStatus(item, events, asOf, timeZone): Status`, `milestoneStatus(m, items, events, asOf, timeZone): {status, finishedAt, members}`.
- `describe.ts`: `describeOp(op, stateBefore)` returning the entry fields, `diffLines(op): Array<['del'|'add', string]>`, `clashLabel(clash, state)`, `FIELD` labels.
- `payload.ts`: `Member = {id, name, roleLabel, color, userId|null}`, `CrStatus`, `Cr = {id, num, title, author, editor, status, ops, revision, createdAt, updatedAt, mergedRev, mergedBy, mergedAt, closedBy, closedAt, closedRev, resolutions, shares: Array<{memberId, permission}>, asks: Array<{memberId, createdAt}>, comments: Array<{id, memberId, kind, body, opIndex, createdAt}>}`, `Resolution = {key, label, chose: 'main'|'cr', mainVal, crVal, from, by}`, `TrackerPayload` (spec 3.7), `QueueRow = {id, kind, payload, addedByMember, addedByAgent, createdAt}`.

- [ ] Step 1: Read the prototype script in `docs/design/2026-10-16-event-tracker-v8.html` (search for `const OPS`, `function replayOps`, `function keysOf`, `function clashesOf`, `function liveOps`, `function crState`, `function info`, `function msStatus`, `function itemStatus`, `function describeOps`, `function diffLines`, `function clashLabel`). Port them to the files above with the spec 3.2 field names (`workItems` with flat `events`, `teamId`, `plannedFinish`, `milestoneId`, `workItemId`).
- [ ] Step 2: Write `tests/support/tracker-fixture.ts`: `buildState(partial)` helper and `larkspurState()` that returns the prototype's Larkspur data (people from `N`, 7 lanes as teams with leads, 2 milestones, 14 work items with the `DUE` dates and the 2 recorded moves of Go-live date and PG-201, all events, Queue events `qe1..qe4`, Queue items `q1`, `q2` with their planned dates). Use stable string ids from the prototype (`golive`, `pg203`, `qe1`...).
- [ ] Step 3: Write the failing tests:
  - ops: each op applies and returns the prototype entry text; `attach` of a missing queue event throws `OpError`; `due` and `msDate` with `why: '  '` throw; `due` appends a move and keeps `firstPlannedFinish`; `place` uses the queue item's `plannedFinish` when the op has none; `replayOps` marks changed ids and turns a failing op into a `skipped` entry without stopping; `applyOp` does not mutate its input (deep-freeze the input in the test).
  - clash: CR op made at rev 0 and Main rev 1 renames the same item differently → 1 clash with key `loop:pg203:title`; same rename → no clash and `liveOps` drops it; CR op made at rev 1 (after seeing rev 1) → no clash; rename vs milestone change on the same item → no clash; `liveOps(..., {[key]: 'main'})` drops the CR op; the latest matching Main op is the reported `y`.
  - status: early, on time, late, finished late, planned for items and milestones; the time-zone boundary case of Review Focus 4; a milestone with no members is planned or late by date.
  - describe: `diffLines` for `place` ("In the queue" → "Team: Engineering"), `due` ("Planned finish: 6 Oct" → "Planned finish: 14 Oct"), `rename`.
- [ ] Step 4: Run `./node_modules/.bin/vitest run tests/unit/tracker` and confirm the failures; implement; rerun until green.
- [ ] Step 5: Run `tsc --noEmit`, `eslint src/tracker tests/unit/tracker tests/support/tracker-fixture.ts`, `prettier --check` on the new files; fix; commit `feat: pure tracker core with operations, clashes and statuses`.

### Task 2: Pure layout for the tracker graph

**Files:**
- Create: `src/tracker/layout.ts`; test `tests/unit/tracker/layout.test.ts`.

**Interfaces:**
- Consumes: Task 1 types and `itemInfo`, `itemStatus`, `milestoneStatus`, `formatDay`.
- Produces: `GEOMETRY` (`VW 1060, X0 236, X1 1046, AXIS_Y 15, MS_Y 33, TRUNK_Y 48, ROW 32, HEAD 22, FOLD 13`), `type View = {hiddenRows: Set<string>, hiddenTeams: Set<string>, asOf: string, timeZone: string, windowStart?: string, windowEnd?: string}`, `layoutTracker(state, view, marks?): TrackerLayout` where `TrackerLayout = {width, height, x(t), t(x), window, ticks, tLine, lanes, rows, segments, eventGroups, flags, slips, stems, links, msLinks, trunk, trunkSegments, milestones, folds, chips, laneDrops}`. Each element carries the data the renderer needs (ids, x, y, colour token names such as `'proceed'|'route'|'danger'|'caution'|'teal'|'ink-2'|'ink-3'`, labels, aria labels, `draft` flags from `marks`).

- [ ] Step 1: Port `hiddenSet` (mode 1 only), `layout`, `emptyStart`, the geometry part of `graphSVG` (lanes, rows, grid ticks every 7 days from the first Monday, T line, stems, segments with the spec 2.8 colours, waiting lines and text, "leads from" curves and the fold behaviour, milestone links with the spec 2.8 colours, trunk and status segments, fold strips, event groups closer than 16 px, flags and slip lines, lane drop targets, milestone label levels) into data, not SVG strings.
- [ ] Step 2: Window: `windowStart` from the view or `addDays(earliest start of an item that is open or finished inside the last 60 days, -3)`; `windowEnd` = later of `asOf + 7 days` and the latest planned date + 3 days. Hide items finished before the window start (prototype `isOff`).
- [ ] Step 3: Tests with `larkspurState()` and `asOf = 2026-10-09T18:00:00+07:00`, window `2026-09-10..2026-10-17`: 7 lanes in team order; one row per visible work item; hiding a team yields one fold strip with the hidden count; hiding a row yields a fold strip with its title; PG-203 segment turns `danger` after 2026-10-07 (planned 2026-10-06); PG-202 shows `caution` after its planned day (finished late); Go-live date has a slip from 30 Sept to 15 Oct; flag colour follows `itemStatus`; milestone "CRM integration live" is `late`; label levels never overlap; `x(t)` and `t(x)` are inverse within 1 ms.
- [ ] Step 4: Gates on the new files; commit `feat: tracker graph layout as pure data`.

### Task 3: Database, server use cases, permissions and the Larkspur seed

**Files:**
- Modify: `src/server/db/schema.ts` (append tracker tables), `src/server/db/migrations/meta/*` (via `drizzle-kit generate` or by hand to match the existing journal)
- Create: `src/server/db/migrations/0004_tracker.sql`, `src/server/tracker/store.ts`, `src/server/tracker/access.ts`, `src/server/tracker/projects.ts`, `src/server/tracker/queue.ts`, `src/server/tracker/crs.ts`, `src/server/tracker/read.ts`, `src/server/tracker/seed/larkspur.ts`, `src/server/tracker/index.ts`
- Modify: `src/server/app.ts` (`seedOnUserCreated` also seeds the tracker demo for the sandbox project), `src/server/domain/projects/index.ts` (`createEmptyProject` also creates the tracker project, the owner member and the teams)
- Tests: `tests/integration/tracker/crs.test.ts`, `tests/integration/tracker/permissions.test.ts`, `tests/integration/tracker/queue.test.ts`, `tests/integration/tracker/seed.test.ts`, `tests/integration/tracker/projects.test.ts`

**Interfaces:**
- Consumes: Task 1 (`applyOp`, `replayOps`, `clashesOf`, `liveOps`, `crState`, schemas, payload types).
- Produces (all take `(db, ctx: ActorContext, input)` and run in one transaction with `lockProject`):
  - `getTrackerPayload(db, ctx, {projectId, actAs?})` → `TrackerPayload`
  - `actingMember(tx, ctx, projectId, actAsCookie?)` → `Member | null`
  - `createTrackerProject(tx, {workspaceId, projectId, userId, userName, teams, milestone?, demo, asOf?, windowStart?, base?})`
  - `addQueueEntry(db, ctx, {projectId, kind, fields})`, `dismissQueueEntry(db, ctx, {projectId, queueId})`
  - `createCr(db, ctx, {projectId, title, ops?})` → `{num}`
  - `appendOp(db, ctx, {projectId, num, op, expectedRevision})`, `removeOp(db, ctx, {projectId, num, index | 'last', expectedRevision})`
  - `crAction(db, ctx, {projectId, num, action, ...})` for every action in spec 3.7
  - `seedTrackerDemo(tx, {workspaceId, projectId, userId, userName})`
- Errors: reuse `AppError` codes (`FORBIDDEN` → 403, `CONFLICT` → 409 for a stale revision or stale picks, `VALIDATION` → 400 for an op that does not fit, `NOT_FOUND` → 404).

- [ ] Step 1: Add the tables of spec 3.5 with the existing `inProject` composite keys, indexes on `(project_id)` and `(cr_id)`, and the migration. Run `TEST_DATABASE_URL=... vitest run tests/integration/db` to confirm the migration applies.
- [ ] Step 2: Write the failing integration tests:
  - projects: `createEmptyProject` with teams makes a tracker project whose base has those teams, an owner member linked to the user, and `owner_member_id`.
  - queue: add an event and an item; dismiss hides it from the payload queue; agent context sets `added_by_agent`.
  - crs: create (num increments per project), append ops with `expectedRevision` (stale → 409), undo, ready (empty → 400), unready, ask, cancel-ask, handover (to a member without edit right → 403), decline, share and remove, comment, merge without clash creates commit rev N+1 and status merged, merge with a clash and no pick → 409, merge with picks records resolutions and a `resolved` comment, a pick of `main` drops that op from the commit, request-changes returns to draft with a `changes` comment, close.
  - permissions: a non-editor cannot append, share or mark ready; a non-owner cannot merge, close or request changes; act-as works only in a demo project and only for its members; a person with no member reads but cannot write.
  - seed: the demo has 7 teams, 14 work items, 2 milestones, 4 queue events, 2 queue items, members Minh (owner, linked to the user), Lan, Quang, Hà, Khoa, commit rev 1 from #1, #2 and #3 ready and clashing on `loop:pg203:title` after #2 merges, #4 draft shared with Khoa (edit).
- [ ] Step 3: Implement. Server-side every write re-validates: replay the CR's live ops plus the new op on the latest Main and reject an op whose entry is `skipped`; set `op.rev` to the current Main revision and `op.by` to the acting member; compute `op.d` with `describeOp`.
- [ ] Step 4: Wire the seed into `seedOnUserCreated` after the existing sandbox seed, for the same project id, with the demo values of spec 3.10. Keep the old seed for now (Task 7 removes it).
- [ ] Step 5: Gates (`tsc`, `eslint`, `prettier --check`, the full `vitest run` with `TEST_DATABASE_URL`); commit `feat: tracker tables, change request use cases, permissions and demo seed`.

### Task 4: REST routes, act-as cookie, project creation input, MCP tools

**Files:**
- Create: `src/app/api/v1/projects/[projectId]/tracker/route.ts`, `.../tracker/act-as/route.ts`, `.../tracker/queue/route.ts`, `.../tracker/queue/[queueId]/route.ts`, `.../tracker/crs/route.ts`, `.../tracker/crs/[num]/ops/route.ts`, `.../tracker/crs/[num]/ops/[index]/route.ts`, `.../tracker/crs/[num]/actions/route.ts`
- Modify: `src/app/api/v1/projects/route.ts` (POST input: `clientName`, `title`, `teams`, optional `milestone {name, date}`), `src/components/shell/NewProjectDialog.tsx` and `new-project.ts` (add the Teams textarea, one per line, default "Implementation\nEngineering\nQA", and the optional first milestone), `src/server/mcp/tools.ts` (add `get_tracker`, `list_queue`, `add_queue_event`, `add_queue_item`, `list_change_requests`, `get_change_request`), `src/contracts/identity.ts` (add scope `queue:add`; agents default to `project:read` + `queue:add`)
- Tests: `tests/integration/tracker/routes.test.ts`, `tests/integration/adapters/mcp-tracker.test.ts`, update `tests/unit/shell/new-project.test.ts`

**Interfaces:**
- Consumes: Task 3 use cases.
- Produces: the routes of spec 3.7; each mutating route returns the fresh `TrackerPayload` (and `{num}` for create). The act-as route sets cookie `pg_act_<projectId>` (`HttpOnly`, `SameSite=Lax`, path `/`) after the use case accepts it.

- [ ] Step 1: Failing tests: GET payload for the seeded sandbox; POST queue; POST crs then ops then actions ready; act-as to Lan then an append by Lan on Minh's CR → 403; MCP `add_queue_event` from an agent token shows in `list_queue` with `agent: true`; `get_tracker` returns statuses; POST /projects with teams creates a tracker project.
- [ ] Step 2: Implement with `route()` and `domain()`; add the numeric `expectedRevision` to the query-number set only if a route reads it from the query.
- [ ] Step 3: Gates; commit `feat: tracker REST routes, act-as, project teams and MCP queue tools`.

### Task 5: Tracker screen, read and navigate (graph, queue, bars, drawers, polling)

**Files:**
- Create: `src/components/tracker/TrackerScreen.tsx`, `TopBar.tsx`, `ContextBar.tsx`, `QueuePanel.tsx`, `TrackerGraph.tsx`, `Pops.tsx`, `Drawers.tsx`, `icons.tsx` (the prototype's Lucide paths), `avatar.tsx`, `api.ts` (typed fetch client for spec 3.7, returns `TrackerPayload`), `view-state.ts` (hidden rows and teams in `localStorage` per project; wrap every storage call in try/catch), `tracker.css`
- Modify: `src/app/(app)/projects/[id]/graph/page.tsx` (server component: load `getTrackerPayload` and render `TrackerScreen`; projects without a tracker row show the empty state), `src/app/(app)/layout.tsx` only if the screen needs the full width
- Tests: `tests/unit/tracker/view-state.test.ts`, `tests/unit/tracker/api.test.ts` (request shapes)

**Interfaces:**
- Consumes: Task 1 (`mainState`, `crState`, `clashesOf`, statuses, `describeOp`), Task 2 (`layoutTracker`), payload types; Task 4 routes (call them through `api.ts`; until Task 4 merges, the routes may 404, so keep mutations behind `api.ts`).
- Produces: `TrackerScreen` props `{payload: TrackerPayload, projectId: string}`; a `useTracker()` hook inside `TrackerScreen` that holds `{payload, view: 'main' | crNum, setPayload}` and polls `GET /tracker` every 5 s while `document.visibilityState === 'visible'`; the `?cr=<num>` URL parameter selects the view.

- [ ] Step 1: Render the prototype layout: top bar (project switcher component reuse, view switcher menu with Main, open CRs and "New change request" and "All change requests", Work list, History, Change requests with count, Demo select only when `payload.project.demo`, acting member avatar), context bar variants of spec 2 and the prototype `renderBar`, Queue panel (tabs, counts, search, cards, Add button), graph SVG from `layoutTracker` (lanes, eye toggles, rows, labels, events as kind icons, flags, slip lines, milestones, links, T pill, legend), event pop, work item pop, date pop (status, first date, moves list), milestone drawer (status, members, moves; fields disabled unless the view is an editable CR), Work list drawer with filters, Change requests drawer (groups Ready, Drafts, Merged, Closed), History drawer (newest first, resolutions line, See changes links to `/projects/[id]/changes/[num]`, Open graph switches the view).
- [ ] Step 2: Eye toggles and fold strips work and persist per project; Demo select calls act-as and replaces the payload; polling refreshes asks and hand-overs.
- [ ] Step 3: Unit tests for `view-state` and `api`; manual check on `next dev --port 3200` against `pg_et` (sign in with the local button; the sandbox seed runs on first sign-in).
- [ ] Step 4: Gates; commit `feat: tracker screen with graph, queue, bars and drawers`.

### Task 6: Tracker screen, editing (drag and drop, modals, change request flows)

**Files:**
- Modify: `src/components/tracker/TrackerScreen.tsx`, `TrackerGraph.tsx`, `QueuePanel.tsx`, `ContextBar.tsx`, `Pops.tsx`, `Drawers.tsx`, `tracker.css`
- Create: `src/components/tracker/Modals.tsx`, `src/components/tracker/drag.ts`, `src/components/tracker/Toast.tsx`
- Tests: `tests/unit/tracker/drag.test.ts` (target mapping from a layout and a point)

**Interfaces:**
- Consumes: Task 5 components and `api.ts`; Task 1 op builders.
- Produces: `commitOp(op)` inside `TrackerScreen`: when the view is an editable CR, call `appendOp` and replace the payload; otherwise open the Read-only modal with the pending ops (spec 2.11) whose buttons create a CR (`POST /crs` with the ops), add to another draft I edit, ask to edit, or edit again.

- [ ] Step 1: Port the prototype pointer drag code: Queue event → work item (attach) or team (New work item modal) or bin (dismiss); Queue item → team (place) or milestone (qms) or bin; event → another row (move) or bin (hide); row label → milestone (msAdd); date flag drag → Move the date modal with the dropped day; milestone diamond drag → milestone Move the date modal. Ghost, drop highlight, bin, Esc cancels, click alternatives (event pop Move to another work item, Change kind, Hide).
- [ ] Step 2: Modals of spec 3.8 with the prototype fields: Add to queue (Event: kind, text, who, when; Work item: name, note, done by, for, leads from, planned finish), Place work item (team, milestone, planned finish), Add event, New work item from event, New milestone, Move the date (new date, reason required, disabled Save while empty), New change request (name, pending change line), Share (link with Copy, people with access, Hand over buttons, add a person), Read-only (spec 2.11 variants).
- [ ] Step 3: Context bar actions: Share, Changes drawer (list with who and why, remove one change, Undo, Open review, Mark as ready), Mark as ready, Edit again, Ask to edit, Cancel, Hand over, Not now, the yellow ask rows; toasts with Undo for the last op.
- [ ] Step 4: Gates; commit `feat: drag and drop editing and change request actions on the tracker screen`.

### Task 7: Review screen for a change request

**Files:**
- Create: `src/app/(app)/projects/[id]/changes/[num]/page.tsx`, `src/components/tracker/ReviewScreen.tsx`, `src/components/tracker/review.css`
- Tests: `tests/unit/tracker/review-model.test.ts` for a pure `reviewModel(payload, num, picks)` in `src/tracker/review.ts` (Before and After states, live ops with descriptions, clashes, canMerge, dropped ops of a merged CR)

**Interfaces:**
- Consumes: Task 1, Task 2 (`layoutTracker` for Before and After), `api.ts` from Task 5 (if Task 5 is not merged yet, create `api.ts` with only the functions this task needs and let the merge keep one copy).
- Produces: `reviewModel(payload, num, picks)`; the page `/projects/[id]/changes/[num]?tab=changes|graph|talk`.

- [ ] Step 1: Port `renderReview`: header (number, title, status chip, author line per status, editors, clash chip), owner buttons on Ready (Close without merging, Request changes with a note box, Merge into Main disabled until every clash has a pick), Back to the graph; clash box with radio cards (Main now · from #N by X / This change request · by Y) for the owner, read-only text for others; Resolved before merge box on merged CRs; draft note; tabs; Changes tab with the side list, Viewed progress (open CRs only), diff cards, event quotes, "Why it moves" quotes, per-change comments, dropped cards on merged CRs; On the graph tab with Before and After and the yellow focus row; Conversation tab with the timeline labels of the prototype `TLK` and a comment box.
- [ ] Step 2: Gates; commit `feat: change request review screen with changes, graph and conversation`.

### Task 8: Remove the promise subsystems

**Files:** delete or rewrite per spec 3.11 and codebase map C.2, E and F.3. Create `src/server/db/migrations/0005_drop_promise.sql`. Modify `src/components/shell/Rail.tsx` (Graph, Settings), `src/app/(app)/projects/[id]/layout.tsx` if it links removed pages, `src/server/app.ts` (seed only the tracker demo; the seed creates the project row itself), `src/server/mcp/tools.ts` (only the tracker tools and `get_project`), `src/contracts/*` (remove promise, record and proposal contracts that no code uses), `docs/mcp-agent-recipe.md`, `fixtures/README.md`.

- [ ] Step 1: Delete code bottom-up with `tsc` as the guide: pages and components first, then routes, domain, engine, layout lib, contracts, fixtures, scripts, eval, tests. Keep auth, session, identity store, workspaces, projects, agent tokens, settings, shell, receipts if still used.
- [ ] Step 2: Migration 0005 drops the unused tables and columns; `runMigrations` on a fresh database passes; `tests/integration/db/*` updated.
- [ ] Step 3: Full gates: `tsc`, `eslint .`, `prettier --check .`, `vitest run` with `TEST_DATABASE_URL`; the old e2e specs are deleted in this task (Task 9 writes new ones). Commit `chore: remove the promise engine, records, proposals and the old graph`.

### Task 9: End-to-end tests, README and screenshots

**Files:** Create `tests/e2e/tracker.spec.ts` (the 13 tasks of the prototype v8 section 3 as one serial flow plus a phone overflow check), `tests/e2e/projects.spec.ts` (New project with teams, empty graph, first change request); update `playwright.config.ts` if needed; rewrite `README.md` sections that describe the product, the walkthrough and the agent recipe; new screenshots in `docs/screenshots/` from the running app.

- [ ] Step 1: Write and run the e2e specs in a separate worktree or with `E2E_PORT=3300` against a throwaway `pg_e2e_*` database.
- [ ] Step 2: Update the README: what the app does, the demo walkthrough (Working as switch), change requests, planned dates with reasons, agents adding to the Queue, local setup, deploy note about the database reset.
- [ ] Step 3: Full gates including Playwright; commit `test: end-to-end tracker flows` and `docs: README for the event tracker`.
