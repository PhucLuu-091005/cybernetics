# Event tracker with change requests: design

- Date: 2026-10-16. Deadline: 2026-10-19 23:59 Asia/Ho_Chi_Minh.
- Branch: `phucluu/event-tracker`, from `phucluu/direction-b` (= `origin/main` 8b4e3a0 + 56 commits). Local only until the owner checks.
- Visual and behavioral reference: `docs/design/2026-10-16-event-tracker-v8.html`. It is a working prototype. When this spec is silent, copy the prototype. Its script holds the reference logic: `OPS`, `replayOps`, `keysOf`, `sameOp`, `clashesOf`, `liveOps`, `itemStatus`, `msStatus`, `graphSVG`, `layout`, `hiddenSet`, the review screen (`renderReview`), and the drag and drop code.
- Codebase facts: `docs/superpowers/specs/2026-10-16-event-tracker-codebase-map.md`.

## 1. Goal

Promise Graph becomes an event tracker for a whole project. It shows what happened at every step, which work led to which work across teams, and why plans changed. People or their agents add events and work items to a Queue, then drag them onto the graph. Main is read-only. Every change goes through a change request that the owner of Main merges.

## 2. Product decisions (binding)

1. Event kinds: Message, Task, Handoff, Decision, Meeting, Delivery, Issue, Done. No promise semantics. A work item is done when it has a visible Done event; its finish time is the time of its last visible Done event.
2. One row per work item, under its team (lane), indented. A work item has an optional parent and zero or more "leads from" links (`after`).
3. Eye toggles hide a row or a whole team. A hidden row or team folds into a thin strip that says what it hides; a click shows it again (prototype mode 1). Hide state is per viewer, kept in `localStorage`, never versioned.
4. Queue: events and work items wait in a project Queue until someone drags them onto the graph. People add them with Add; agents add them through MCP. No email or Slack sync.
5. Drag and drop: a Queue work item onto a team places it (onto a milestone diamond sets its milestone while it waits); a Queue event onto a work item attaches it; a Queue event onto a team opens "New work item" from it; an event up or down moves it to another work item; anything onto the bin hides it (events) or removes it from the Queue (Queue cards). A work item name onto a milestone diamond adds it to that milestone. Every drop has a click alternative (pops and modals).
6. Milestones have 5 statuses: Planned, Finished early, Finished on time, Late, Finished late. A milestone is done when all its work items are done; its finish is the latest finish of its work items. Late = not done and today is after the planned date.
7. Each work item has a Planned finish (a date). Work items use the same 5 statuses against their own Planned finish. Moving a Planned finish or a milestone date needs a written reason (not empty after trim). The app keeps the first date and every move: who, when, from, to, why. A drag of the date flag or the milestone diamond opens the reason dialog with the dropped date.
8. Colours on a row: blue while open, green when done; the part of the line after the item's own Planned finish is red while open and amber when done late. The link from a work item to its milestone is red when the item is open and planned to finish after the milestone date, amber when it finished after the milestone date, grey otherwise.
9. No breakdown types and no day-count rules (no reply, accept, hedge or at-risk windows).
10. Projects: a signed-in user creates a project (client, project name, teams one per line, optional first milestone with date). Each project has one Main graph. The creator owns Main. A team can also be added later through a change request.
11. Main is read-only. A drag or edit on Main opens "Main is read-only" with New change request; the change goes into the new change request. The same dialog appears on a CR the person cannot edit, with the right buttons (Ask to edit, Edit again, Add to #N, New change request).
12. Change request (CR): statuses Draft, Ready, Merged, Closed. Numbered per project (#1, #2...). A CR view always shows the latest Main plus the CR's own changes. There is no Sync.
13. Share: the current editor adds people with Can edit or Can view. Everyone in the project can view every CR.
14. One editor at a time. The author edits first. A person with Can edit (or the author) presses Ask to edit; the current editor presses Hand over or Not now. The editor can also hand over without an ask (Share, Hand over). Asks wait; nothing moves editing automatically.
15. Mark as ready locks the CR (needs at least 1 change). The current editor presses Edit again to unlock it (back to Draft).
16. The owner of Main reviews a CR on a full-page review screen: Changes (one card per change with red before and green after lines, the event quote, the reason of a date move, a Viewed box, per-change comments, Show on graph), On the graph (Before and After, the picked change in yellow, changes ringed in violet), Conversation (timeline and comments). Owner actions on a Ready CR: Merge into Main, Request changes (back to Draft with a note), Close without merging.
17. Clash: a CR change clashes when Main took a different change on the same spot after the CR change was made. Spots (keys): queue event placement `event:<id>`, queue item placement `item:<id>`, event `act:<id>`, work item `loop:<id>:title`, `loop:<id>:ms`, `loop:<id>:due`, milestone `ms:<id>:date`, `ms:<id>:name`. Two different fields of one work item never clash. An identical change already in Main is dropped silently. The owner picks Main or the CR for every clash before Merge; the merge records each pick (label, kept value, dropped value, source CR number, who).
18. A merged or closed CR is read-only history. History lists every merge into Main, newest first: CR, author, merger, time, changes, resolutions, with See changes and Open graph. Open graph shows Main right after that merge.
19. Demo: each signed-in user gets a sandbox with the Larkspur demo project. In a demo project, a "Demo · Working as" select switches the acting member (Minh Trần owns Main; Lan Phạm, Quang Nguyễn, Hà Đỗ, Khoa Lê). Outside demo projects, the acting member is the signed-in user's member. The top right shows the acting member: avatar, name, role.

## 3. Architecture

### 3.1 Approach

Build the tracker as a new vertical slice, then delete the promise subsystems. Port the prototype logic to TypeScript instead of adapting the promise engine, React Flow layout or proposal pipeline.

- `src/tracker/`: shared pure code, used by server and browser. No React, no Node APIs, no I/O.
- `src/server/tracker/`: database tables access, permissions, use cases, seed.
- `src/app/api/v1/projects/[projectId]/tracker/**`: REST routes through the existing `route()` and `domain()` helpers.
- `src/components/tracker/`: React UI. `src/app/(app)/projects/[id]/graph/page.tsx` renders the tracker; `src/app/(app)/projects/[id]/changes/[num]/page.tsx` renders the review.
- A CR is an ordered list of operations (option B of the codebase map). Main is a base snapshot plus the operations of every merge, replayed in order. The browser replays with the same pure code, so views need no server round trip.

### 3.2 Pure model (`src/tracker/model.ts`)

Dates are `YYYY-MM-DD` strings in the project time zone. Instants are ISO 8601 strings with offset. Ids are UUID strings made by the client inside operation arguments, so a replay is deterministic.

```ts
type EventKind = 'message'|'task'|'handoff'|'decision'|'meeting'|'delivery'|'issue'|'done';
type Person = { id: string; name: string };                       // people in the story (event authors, Done by, For)
type Team = { id: string; name: string; leadId: string | null };   // lead = default Done by for a new item
type DateMove = { from: string; to: string; why: string; by: string /* member id */; at: string };
type Milestone = { id: string; name: string; planned: string; firstPlanned: string; moves: DateMove[] };
type WorkItem = { id: string; title: string; teamId: string; doneBy: string; requestedBy: string;
  milestoneId: string | null; parentId: string | null; after: string[];
  plannedFinish: string; firstPlannedFinish: string; moves: DateMove[]; since: string | null };
type TrackerEvent = { id: string; workItemId: string; kind: EventKind; at: string; by: string; text: string;
  addedBy: 'agent' | string | null; hidden: boolean };
type QueueEvent = { id: string; kind: EventKind; at: string; by: string; text: string; addedBy: string | null; agent: boolean; createdAt: string };
type QueueItem = { id: string; title: string; note: string; doneBy: string; requestedBy: string; milestoneId: string | null;
  after: string | null; plannedFinish: string; addedBy: string | null; agent: boolean; createdAt: string };
type TrackerState = { people: Person[]; teams: Team[]; milestones: Milestone[]; workItems: WorkItem[];
  events: TrackerEvent[]; queue: { events: QueueEvent[]; items: QueueItem[] } };
```

Zod schemas for all of these live in `src/tracker/schemas.ts` and validate every write.

### 3.3 Operations (`src/tracker/ops.ts`)

`type Op = { op: OpName; a: Record<string, unknown>; rev: number; by: string; d?: OpDescription }` where `rev` is the Main revision the editor saw when making the change, `by` is the member id, and `d` is the stored description (item, change, before, after, icon, why).

Operations (prototype names): `attach {eventId, workItemId}`, `place {itemId, teamId, plannedFinish?}`, `qms {itemId, milestoneId}`, `fromEvent {id, eventId, teamId, title, doneBy, requestedBy, after, plannedFinish}`, `addEvent {workItemId, ev}`, `move {eventId, to}`, `kind {eventId, kind}`, `hide {eventId}`, `msDate {milestoneId, date, why, by, at}`, `msName {milestoneId, name}`, `msRemove {workItemId}`, `msAdd {workItemId, milestoneId}`, `newMs {id, name, planned, members}`, `rename {workItemId, title}`, `due {workItemId, date, why, by, at}`, `addTeam {id, name, leadId}`.

Pure functions:

- `applyOp(state, op): { state, entry }` throws `OpError` when the op does not fit (a queue entry is gone, an id is unknown, a reason is empty).
- `replayOps(base, ops): { state, entries, marks }`: skipped ops become entries with `skipped: true`; `marks` lists ids changed by the ops (rows, events, milestones, dates) for violet rings.
- `keysOf(op)`, `sameOp(x, y)` (compares `op` and `a` only).
- `clashesOf(crOps, commits)`: for each CR op, look at the Main ops merged after `op.rev`; drop it when an identical op exists; report a clash when a key matches: `{ key, index, x, y, commit }` (latest matching Main op wins).
- `liveOps(crOps, commits, picks?)`: CR ops minus identical ones, minus ops whose clash was picked `main`.
- `mainState(base, queue, commits, upto?)` and `crState(base, queue, commits, cr)`: CR view = Main at the latest revision plus `liveOps`; a merged CR shows Main right after its merge; a closed CR shows Main at its close revision plus its ops.
- `describe(op, state)`: plain words for lists and diff cards; `diffLines(op)` gives the before and after lines; `clashLabel(clash, state)`.

The queue in the state: `initial = base + all queue rows that are not dismissed`. Ops consume queue entries by id. A queue row added after a merge is still in the initial list, so replays stay valid.

### 3.4 Status and layout (`src/tracker/status.ts`, `src/tracker/layout.ts`)

- `itemStatus(item, events, asOf, timeZone)` and `milestoneStatus(milestone, items, events, asOf, timeZone)` return `planned | early | ontime | late | flate` with the prototype rules, compared by calendar day in the project time zone.
- `layoutTracker(state, view, options)` returns a render model: lanes, rows (y, fold strips), line segments with colours, event groups (icons stacked when closer than 16 px), date flags and slip lines, milestone diamonds with 2 label levels, trunk segments, "leads from" curves, links to milestones, parent stems, T line, ticks. `view = { hiddenRows, hiddenTeams, asOf, windowStart, windowEnd }`. Default window: from `project.windowStart` (or 21 days before the earliest open item's start) to the later of `asOf + 7 days` and the latest planned date + 3 days. The render keeps the prototype geometry (viewBox width 1060, label column 236 px, row 32 px, head 22 px, fold 13 px) and scales to the container width.

### 3.5 Storage (migration `0004_tracker.sql`, Drizzle in `src/server/db/schema.ts`)

All tables carry `workspace_id` and `project_id` with the existing composite foreign key pattern (`inProject`).

| Table | Columns |
|---|---|
| `tracker_projects` | `project_id` PK, `workspace_id`, `base` jsonb (TrackerState without queue), `time_zone` text default `Asia/Ho_Chi_Minh`, `window_start` date null, `as_of` timestamptz null (demo clock; null = now), `demo` bool, `owner_member_id` uuid |
| `tracker_members` | `id` PK, `workspace_id`, `project_id`, `name`, `role_label`, `color`, `user_id` null FK users, `created_at` |
| `tracker_queue` | `id` PK, `workspace_id`, `project_id`, `kind` (`event`/`item`), `payload` jsonb, `added_by_member` null, `added_by_agent` bool, `created_at`, `dismissed_at` null |
| `tracker_commits` | `workspace_id`, `project_id`, `rev` int, `cr_id`, `merged_by` member, `merged_at`, `ops` jsonb, `resolutions` jsonb; PK (`project_id`, `rev`) |
| `tracker_crs` | `id` PK, `workspace_id`, `project_id`, `num` int, `title`, `author`, `editor` (members), `status` (`draft`/`ready`/`merged`/`closed`), `ops` jsonb, `revision` int, `created_at`, `updated_at`, `merged_rev`, `merged_by`, `merged_at`, `closed_by`, `closed_at`, `closed_rev`, `resolutions` jsonb; unique (`project_id`, `num`) |
| `tracker_cr_shares` | `cr_id`, `member_id`, `permission` (`edit`/`view`); PK (`cr_id`, `member_id`) |
| `tracker_cr_asks` | `cr_id`, `member_id`, `created_at`; PK (`cr_id`, `member_id`) |
| `tracker_cr_comments` | `id` PK, `cr_id`, `member_id`, `kind` (`created`, `ready`, `unready`, `changes`, `comment`, `resolved`, `merged`, `closed`, `shared`, `ask`, `handover`, `decline`), `body` text null, `op_index` int null, `created_at` |

Every write locks the project row (existing `lockProject`) or the CR row, checks `expectedRevision` where given, and runs in one transaction.

### 3.6 Members, acting member and permissions (`src/server/tracker/access.ts`)

- The project creator gets a member linked to their user id; it is `owner_member_id`.
- Acting member: in a demo project, the cookie `pg_act_<projectId>` names a member of that project; otherwise the member linked to the session user. With no member, the person can read but not write.
- Rules (server side, inside the transaction):
  - create CR, comment, add to Queue, dismiss a Queue card: any member.
  - add op, undo, remove op, share, mark ready, edit again: the CR's current editor, and the status allows it (draft for ops and ready; ready for edit again).
  - ask: a member with edit right (author or share `edit`) who is not the editor; cancel ask: the asker; hand over: the editor, to a member with edit right; not now: the editor.
  - merge, request changes, close without merging: the owner member; merge needs status `ready` and a pick for every clash; the server recomputes clashes and rejects stale picks.
  - act as: only in demo projects, only members of that project.
- Agents (MCP tokens) act as the token user's member and may only read and add to the Queue.

### 3.7 API (`src/app/api/v1/projects/[projectId]/tracker/...`)

| Method and path | Body | Result |
|---|---|---|
| `GET /tracker` | | `TrackerPayload` |
| `POST /tracker/act-as` | `{memberId}` | payload, sets the cookie |
| `POST /tracker/queue` | `{kind, ...fields}` | payload |
| `DELETE /tracker/queue/[queueId]` | | payload |
| `POST /tracker/crs` | `{title, ops?}` | payload + `{num}` |
| `POST /tracker/crs/[num]/ops` | `{op, expectedRevision}` | payload |
| `DELETE /tracker/crs/[num]/ops/[index]` | `{expectedRevision}` | payload (index `last` = undo) |
| `POST /tracker/crs/[num]/actions` | `{action, ...}` where action is `ready`, `unready`, `ask`, `cancel-ask`, `handover {to}`, `decline {who}`, `share {memberId, permission}` (`permission: 'remove'` deletes), `comment {body, opIndex?}`, `merge {picks}`, `request-changes {note}`, `close` | payload |
| `POST /projects` | `{clientName, title, teams[], milestone?}` | the new project (tracker project, creator owns Main) |

`TrackerPayload = { project: {id, title, clientName, timeZone, windowStart, asOf, demo, ownerMemberId}, members: Member[], me: Member | null, base, queue: {events, items}, commits: Commit[], crs: Cr[] }` where `Cr` holds ops, shares, asks and comments. The browser polls `GET /tracker` every 5 seconds while the page is visible, so asks and hand-overs show up without reload.

### 3.8 UI (`src/components/tracker/`)

Port the prototype screen by screen, with the app's tokens (`src/app/globals.css` has the same token names as the prototype) and a new `tracker.css`. Components: `TrackerScreen` (state, polling, view = Main or CR), `TopBar` (project switcher reuse, view switcher, Work list, History, Change requests with count, demo select, acting member), `ContextBar`, `QueuePanel`, `TrackerGraph` (SVG from `layoutTracker`, pointer drag and drop with ghost and drop highlight, bin), `Pops` (event, work item, date, rename, kind), `Drawers` (Work list with filters, Milestone, Changes, Change requests, History), `Modals` (Add to queue, Place work item, Add event, New work item from event, New milestone, Move the date, New change request, Share, Read-only), `Toast` with Undo, and `ReviewScreen` on its own route. Keyboard: Esc closes the top layer; every SVG target has `role="button"`, `tabindex=0`, an `aria-label`, and Enter or Space activates it. Phone width (390 px): no horizontal page scroll; the Queue stacks above the graph and its cards scroll sideways.

### 3.9 MCP (`src/server/mcp/tools.ts`)

Tools: `get_project`, `get_tracker` (teams, work items with status and planned finish, milestones with status, open CRs), `list_queue`, `add_queue_event`, `add_queue_item`, `list_change_requests`, `get_change_request`. Scopes: `project:read`, `queue:add`. Remove every promise, record, proposal, revert and restore tool. Update `docs/mcp-agent-recipe.md`.

### 3.10 Seed (`src/server/tracker/seed/larkspur.ts`)

The sandbox hook seeds the Larkspur demo as a tracker project: the prototype's people, 7 teams, 2 milestones, 14 work items with planned finish dates and 2 recorded moves (Go-live date, PG-201), events, the 4 Queue events and 2 Queue work items, members Minh (owner, linked to the signed-in user), Lan, Quang, Hà, Khoa, `as_of` 2026-10-09T18:00+07:00, `window_start` 2026-09-10, history rev 1 (#1 "Explain the go-live slip", merged), #2 and #3 Ready (they clash on the PG-203 name), #4 Draft shared with Khoa.

### 3.11 Removal

After the tracker screens work: delete the promise engine, records, inbox, evidence, citations, annotations and markers, proposals and commits domain, revert and restore, React Flow graph and `src/lib/graph-layout`, review queue, the old history, inbox, records, proposals and review pages, v1 fixtures and the fixture build script, gold and eval, and their tests. Migration `0005_drop_promise.sql` drops `records`, `record_versions`, `graph_commits`, `graph_proposals`, `mutation_receipts` only if nothing still uses it, and `projects.main_commit_id`, `projects.evidence_revision`, `projects.source_routing`. The rail keeps Graph and Settings. Settings keeps agent tokens with the new scopes. A deployed database needs a reset and a re-seed.

## 4. Testing

- Unit (Vitest): ops (every op, skipped cases, ids), clashes (the owner rule: a change made after seeing the new Main value does not clash; identical changes drop; field-level keys), statuses (5 values per item and milestone, day boundaries in the time zone), layout (rows per team, fold strips, flags, slip line, colours, label levels), describe and diff lines.
- Integration (Vitest with `TEST_DATABASE_URL`): project creation and owner; queue add and dismiss; CR create, op append under the lock with `expectedRevision`; ask, hand over, not now, cancel; share; ready and edit again; merge without clash; merge with picks and the recorded resolutions; stale picks rejected; request changes; close; every permission rule rejects the wrong member; act-as only in demo projects; seed contents.
- E2E (Playwright, run in a separate worktree, never against port 3100): the 13 prototype tasks of v8 section 3, light theme, plus a phone-width overflow check.
- Gates: `tsc --noEmit`, `eslint .`, `prettier --check .`, `vitest run`, Playwright. Capture each real exit code.

## 5. Out of scope

Email and Slack sync; inviting real users by email; notifications outside the app; automatic date rules; revert and restore of Main; field-level merge inside one CR.
