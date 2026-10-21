# Codebase map: Promise Graph (direction-b) to the event tracker

Source: worktree `scratchpad/dirb`, branch `phucluu/direction-b`, head `c1f06a2` (2026-10-16 11:32 +0700).
All paths below are relative to that worktree. Line numbers refer to `c1f06a2`.
The map is read-only work. No file in the repository changed.

Size scale used in section G: **S** = less than 1 day, **M** = 1 to 3 days, **L** = more than 3 days (one developer with agent help).

---

## A. Branch state

### A.1 Facts about the refs

| Ref | Head | What it is |
|---|---|---|
| local `main` | `77fe22c` | 3 docs-only commits from 2026-10-10..12. The reflog shows no move after 2026-10-12 20:22 (rename `master` to `main`). |
| `origin/main` | `8b4e3a0` | The real trunk: PR #1 to #14 merged, last merge 2026-10-15 15:50. |
| `phucluu/direction-b` | `c1f06a2` | This branch. Local only. |
| `phucluu/zoom-out` | `e6e6c67` | direction-b branched from its old head `8d6187a`. Another session then added 3 commits. |

- Local `main` and direction-b have **no common ancestor**. `git merge-base main phucluu/direction-b` returns nothing (rc 1).
- Local `main` is the pre-rewrite copy of the first 3 commits. Its tree equals the tree of `7e6841f` in the rewritten history (`git diff main 7e6841f` is empty). The 2026-10-14 history rewrite changed only the author to `PhucLuu-091005`.
- `origin/main` has the same tree as `38dfc7e` (`git diff 38dfc7e origin/main` is empty). Its 6 extra commits are PR merge commits only.

### A.2 Commits since the merge base

Local `main` (unrelated history, all commits):

```
77fe22c docs: revise promise graph for external agents and versioned proposals
f7468f2 docs: evaluate architectures and select modular monolith with worker
d0896c9 docs: draft investigator requirements and agent implementation plan
```

`origin/main` since merge base `38dfc7e` (test: allow a 3 s first paint on CI runners):

```
8b4e3a0 Merge pull request #14 (graph-polish)     f17b190 Merge pull request #13 (day-columns)
14d96e0 Merge pull request #12 (tickets-handoffs) ea7639f Merge pull request #11 (ui-event-cards)
8b4d0c2 Merge pull request #10 (ui-graph-canvas)  c6a7a46 Merge pull request #9 (ui-theme-cursor)
```

`phucluu/zoom-out` since `8d6187a` (not in direction-b):

```
e6e6c67 feat: milestone statuses from their loops, late loops in pink, editable milestone panel
36782d4 fix: sidebar links stay inside the folded rail on hover and when selected
132e09f feat: closed loops merge into their own milestone; the pointed branch glows
```

`phucluu/direction-b` since `38dfc7e` (56 commits, newest first; 184 files, +13083/-5502):

```
c1f06a2 fix: scope the empty-graph link checks to the block and close the New project dialog through its close event
be144e8 feat: create a project from the project switcher and open its empty graph
72afbf4 fix: read-only graph keys work after a card press, and far-apart steps open on the earliest one
1a0624c fix: the change set graph opens on the changed steps and writes no browser storage
515787f feat: Review shows the change set graph under What changes, with Reject and Approve beside the title
52ed696 feat: remove the Notes card, the loop notes and the summary note
7d0f73f docs: retake the README screenshots from the current app
6def0af docs: README and fixtures README use the real fixture counts
8c35ff8 docs: SRD matches the list columns, the list button, the notes heading and the cite reset
ec4f8f4 chore: drop a comment that restates the name, state the reason in another, and name what the migration test checks
ade592c fix: on-screen wording says step and No changes
cdbd5ff fix: the grey cite tooltip is true for a step after the As-of time and for a non-step cite
4332e1d fix: the Undo preview says undo and a plain reason, with no git or engine words
ba2a9c9 fix: change-set tables show a note in full with numbered cites and say cited steps
58c624a fix: the milestone panel counts a finished loop as past, not broken
d10e52f docs: get_project no longer mentions analysis freshness
2727078 docs: notes replace escalations in the README, SRD and agent recipe
eded5fd feat: Settings shows plain permission names and when each token last called the app
35966c0 fix: one kind label map; the Activity test fails on any console error
5cd96cc fix: Activity uses plain words and no duplicate React key
d1a1f5b fix: change-set diff and act editor say Requested by and Done by
9243e50 feat: problems on finished loops show as past; parties read Requested by and Done by
691cad9 fix: the list button closes an open panel; tests pin the first view and the jump geometry
32a3020 feat: the graph opens fitted to the project; a loop-list click opens the loop panel
505fac4 fix: a note cite opens its loop even when a filter hides it
c86ac87 feat: notes card above the graph and notes in the loop panel, with numbered step links
df9894e feat: notes cite steps with [act:] markers; the fixture history ends with a project summary
048c0ba style: drop CSS of the removed escalation screens
e80cedb feat: remove escalations from pages, API, MCP, scopes, database and fixtures
ca8ea8b docs: direction B spec and plan (remove escalations, notes, snag fixes)
8d6187a feat: readable zoom-out with the trunk on top and resizable lanes
93efe8d feat: plain words on every screen; ids, revisions and hashes move into Technical details
91aa5de feat: confirm reject, reuse My review, close popovers, name folded rail icons
081fbe3 fix: review queue counts a record as decided when the approved graph or My review decides it
7f17e1c docs: fix round 1 for the simpler screens (source of screenshots, day widths, tabs, words)
11e2006 docs: README, screenshots and decision record for the simpler screens
0d8b3a9 feat: canvas keeps zoom, fit and full screen only
e4888f0 test: e2e merge flows run through the Review screen
e617953 test: ignore a record against a stale My review
1d252c9 test: guard rail fold and Ignore until hydrated, hide dev indicator, cover My review reuse and stale ids
57e2495 test: review queue approve, update, conflict, ignore and double approve
3053ec5 fix: one pending count for the rail, the Review tabs and the change set note
5420de1 feat: Review screen with change sets and new records in one queue
498ff42 fix: reuse the created My review draft when ignoring a record retries
299162c feat: record decisions go into one change set called My review
d7e0552 feat: icons and mockup styling for Problems only, Filter and Activity
1bcf936 feat: graph header in plain words, and filters behind search, Problems only and Filter
ce37694 fix: rail box model, mobile layout and project menu clipping
f818a4c feat: one-project rail with Graph, Review and Escalations that folds to icons
ce1cf4b fix: last plain-word strings in rebase, preview and answer draft
7dcd47d fix: plain words in the undo and go back preview
adc18dd fix: remove leftover git words from owned screens
d881cb9 feat: plain words on the record, change set, activity and settings screens
e63f7eb feat: review queue rules for change set state, My review and links
bea4505 docs: implementation plan for the simpler screens
e21b60d docs: design simpler screens with a review queue and a folding sidebar
```

### A.3 Conflict check (`git merge-tree --write-tree`, no worktree touched)

| Merge | Result | Conflicting files |
|---|---|---|
| local `main` + direction-b | `fatal: refusing to merge unrelated histories` | With `--allow-unrelated-histories`: 3 add/add conflicts: `docs/agent-tasks/2026-10-12-promise-graph-tasks.md`, `docs/superpowers/plans/2026-10-12-promise-graph-implementation.md`, `docs/superpowers/specs/2026-10-12-promise-graph-srd.md` |
| `origin/main` + direction-b | Clean, tree `a69adf2` | None |
| `phucluu/zoom-out` + direction-b | 4 files in conflict | `src/components/graph/GraphScreen.tsx` (1 hunk), `src/components/graph/MilestonePanel.tsx` (7), `src/components/graph/filters.ts` (4), `tests/unit/graph/filters.test.ts` (1) |

**Answer.** direction-b does not rebase onto local `main`: the histories are unrelated, and a rebase would replay all 178 commits onto a docs-only root. direction-b rebases cleanly onto `origin/main`: the base tree is identical, so the 56 commits replay with no change. Treat `origin/main` (8b4e3a0) as the trunk. Do not base new work on local `main` until someone resets it to `origin/main`.

`e6e6c67` on zoom-out implements item 4 of the new model (the 5 milestone statuses). Port its engine logic by hand (about 45 lines in `src/server/loops/engine/index.ts`, plus `MilestoneStatusSchema`). Do not merge it: the 4 conflicting files are files that the new model rewrites anyway.

---

## B. Data model

### B.1 Zod contracts (`src/contracts/`, 1,673 lines)

| File | Lines | Main schemas |
|---|---|---|
| `primitives.ts` | 63 | `IdSchema` (uuid), `RevisionSchema`, `TimestampSchema`, `DateSchema`, `DigestSchema`, `SideSchema` client/vendor (10), `PageInputSchema`, `DomainErrorSchema`, `boundedJson` |
| `identity.ts` | 96 | `ScopeSchema` 4 scopes (10-15), `DEFAULT_AGENT_SCOPES` without `graph:merge` (17-21), `ActorReferenceSchema` user/agent (22-25), `ActorContextSchema` (33-41), agent token schemas |
| `graph.ts` | 319 | `ActTypeSchema` 11 acts (14-26), `DueSchema`, `CitationSchema` (30-35), `PartySchema`, `PersonSchema`, `DepartmentSchema` with side (47-52), `MilestoneSchema` plannedDate/currentDate/reachedAt/anchorLoopId (53-61), `ActSchema` (62-76), `LoopSchema` with `parentLoopId`, `afterLoopIds` (77-88), `RecordDecisionSchema` (89-98), `AnnotationSchema` (99-108), `GraphContextSchema` with 4 day-window rules (109-124), `GraphSnapshotSchema` schemaVersion 1, 5 MB cap (125-162), `GraphOperationSchema` put/remove/set_context (164-253), `EntityChangeSchema` (279-285), `ConflictSchema` (287-294) |
| `engine.ts` | 129 | `LoopStateSchema` 8 states (13-22), `BreakdownTypeSchema` 7 types (23-31), `SeveritySchema`, `MilestoneStatusSchema` reached/blocked/at_risk/on_track (33), `DerivedLoopSchema` (71-93), `DerivedMilestoneSchema` (94-102), `EngineOutputSchema` with counts (103-117) |
| `proposals.ts` | 236 | `ProposalSchema` status draft/merged/closed (29-43), `CommitBaseSchema` kind initial/merge/revert/restore (44-58), create/update/review/merge inputs, `ProposalReviewSchema` with `effects` (state and breakdown deltas, 107-115), `ConflictResolutionSchema` main/proposal/replacement (151-164), rebase/revert/restore inputs |
| `records.ts` | 284 | `SourceKindSchema` paste/agent/slack/gmail (19), record input/version, ingest receipt, chunk read, `InboxStateSchema` (180-186), inbox/search results |
| `mcp.ts` | 275 | `ProjectSchema` with `clientName`, `mainCommitId`, `evidenceRevision`, `sourceRouting` (32-46), `ViewSelectionSchema` main/commit/proposal (54-62), `SnapshotPageSchema`, `GetGraphResultSchema` (loops, counts), `ListLoopsInputSchema` with states (162-180), `GetLoopResultSchema`, history/commit/proposal results, `DiffSummarySchema` |
| `layout.ts` | 142 | `LayoutOptionsSchema` (pxPerDay, dayWidths, cards), `LaneLayoutSchema`, `ActGlyphSchema`, `BranchLayoutSchema` (tone, breakdownMarkers, task) (56-84), `GatewayLayoutSchema`, `ConnectorLayoutSchema`, `MilestoneLayoutSchema` (ghostX, slipPath), `GraphLayoutSchema` |
| `views.ts` | 33 | `GraphViewSchema`: snapshot + `engine` + sources (16-31) |
| `markers.ts` | 28 | `[act:<uuid>]` note markers for annotations |
| `domain.ts` | 57 | Port interfaces and function types (`ThreeWayRebase`, `DeriveProject`, `LayoutPromiseGraph`) |

### B.2 Drizzle schema (`src/server/db/schema.ts`, 300 lines; migrations `src/server/db/migrations/0000..0003`)

| Table | Lines | Notes |
|---|---|---|
| `users` | 52-58 | `subject` (Google sub, unique), `email`, `name` |
| `workspaces` | 59-63 | name only |
| `workspace_members` | 65-80 | PK (workspace_id, user_id). No role column. |
| `projects` | 81-103 | workspace_id, title, client_name, `main_commit_id` (head pointer), `evidence_revision`, source_routing |
| `records` | 104-130 | source, external_id, current_version_id, withdrawn_at |
| `record_versions` | 131-177 | immutable body text, digest, search text, author, recipients, quoted ranges, permalink, provenance |
| `mutation_receipts` | 178-197 | idempotency: PK (project, actor, operation, key) + stored result |
| `graph_commits` | 198-234 | `sequence`, `parent_id`, full `snapshot` JSONB, `snapshot_hash`, `actor`, `message`, `kind`, `proposal_id`, `target_commit_id`, `reviewed_evidence_revision` |
| `graph_proposals` | 235-268 | `base_commit_id`, full `candidate` JSONB, `revision`, `author`, `title`, `rationale`, `evidence_revision`, `status`, `merged_commit_id` |
| `agent_tokens` | 269-300 | per user and project; hash, scopes, expiry, revoke, last_used_at |

Every tenant table carries `workspace_id` and `project_id` with composite foreign keys (`inProject`, `sameProject`, 37-50). Postgres rejects a reference that crosses a project.

### B.3 How each concept is stored

- **Snapshots.** One complete JSON document per version: `graph_commits.snapshot` and `graph_proposals.candidate`. The snapshot holds `context` (time zone, window, holidays, 4 day-window rules, people, departments, milestones), `acts`, `loops`, `annotations`, `recordDecisions`. Caps: 3,000 acts, 300 loops, 5 MB. Validation runs in 3 layers: `GraphSnapshotSchema`, `referenceErrors` (`src/server/graph/references.ts` 5-59, task rules 61-97), and `validateSnapshot` with citation and quote checks (`src/server/graph/validate.ts` 82-150).
- **Commits and history.** `graph_commits` is an append-only chain (`sequence`, `parent_id`). `projects.main_commit_id` is the head. `advanceMain` moves it with compare-and-set (`src/server/domain/commits/store.ts` 48-63). A new project gets an `initial` commit (`src/server/domain/projects/index.ts` 97-111). History reads summaries without snapshots (`src/server/domain/commits/history.ts`). Revert and restore make new commits (`commits/revert.ts`, `commits/restore.ts`, `commits/preview.ts`, `src/server/graph/revert.ts`).
- **Proposals (change sets).** `createProposal` copies Main into `candidate` (`domain/proposals/create.ts` 50-66). `updateProposal` applies up to 100 operations, validates, and bumps `revision` (`update.ts` 48-108; the draft check is at 75-76). `reviewProposal` returns a diff, conflicts and loop effects plus a digest (`review.ts` 48-114). `mergeProposal` requires base == Main, a matching digest and `graph:merge`, then inserts a `merge` commit (`merge.ts` 22-116; rebase check 50-57). `applyRebase` resolves conflicts and moves the base (`rebase-apply.ts`). `closeProposal` sets `closed` with no author check (`close.ts` 12-50).
- **Records and inbox.** Records are outside the graph. Ingest and withdraw bump `projects.evidence_revision` (`domain/records/ingest.ts` 146, `withdraw.ts` 14). The inbox state of a record (pending, included, ignored, superseded, withdrawn) comes from the snapshot `recordDecisions` and act citations (`domain/inbox/list.ts`, `countPending` at 69). Every act must cite a record range and carry a verified quote.
- **Annotations.** Snapshot collection `annotations` (`{id, text, actIds}` with `[act:]` markers). Commit `52ed696` removed the Notes UI. The data model, diff, references, seed and MCP still carry annotations.
- **Members.** Only `workspace_members`. No project membership, no role, no owner. See section D.
- **Evidence coupling.** A proposal must pin the current `evidence_revision` before review or merge (`domain/proposals/digest.ts` 46-49). `evidenceRevision` appears in about 40 source files.

### B.4 Conflict unit

- `diffSnapshots` compares **complete entities** (`src/server/graph/diff.ts` 16-65). Arrays are keyed by `id` (record decisions by `recordVersionId`). Each scalar context field (`timeZone`, `windowStart`, and so on) is its own key.
- `threeWayRebase` keys every change as `${collection}/${id}` (`src/server/graph/rebase.ts` 141-147). The comment at line 133 states it: "a whole entity is the unit of conflict". Two edits to different fields of one loop conflict. A unit test pins this rule: `tests/unit/versioning/versioning.test.ts:145` ("conflicts on divergent edits to the same complete entity even across different fields").
- `compositionConflicts` (rebase.ts 76-131) validates the composed snapshot. It binds each reference or schema error to an entity key.
- `resolveRebase` (`src/server/graph/resolve.ts` 19-124) accepts one resolution per entity key: `main`, `proposal` or `replacement` with a full entity image.

### B.5 Cost of field-level conflicts: M

The pipeline is pure and small (diff 65 lines, rebase 186, resolve 124, apply-operations 49). The change:

1. Add `field` to `EntityChangeSchema`, `ConflictSchema` and `ConflictResolutionSchema` (`src/contracts/graph.ts` 279-294, `proposals.ts` 151-164).
2. In `threeWayRebase`, when both sides change one entity, diff the two images per top-level field. Merge disjoint fields (Main image, then overlay the CR fields). Report one conflict per field with different values.
3. Key resolutions by `collection/id/field` in `resolve.ts`. Keep `compositionConflicts` at entity level, because a dangling reference belongs to an entity.
4. Treat array fields (`afterIds`) as one atomic value.
5. Store each date move as its own entity (collection `dateMoves`), not as an array inside a work item. Two CRs that append moves then never conflict; only `plannedFinish` conflicts.
6. Rewrite about 41 unit tests (`versioning.test.ts` 27, `resolve.test.ts` 14) and `tests/integration/history/rebase.test.ts` (7).

**Semantic risk.** The owner rule is "same field as something merged **after the change was made**". A three-way merge against the CR base flags every field that both sides changed since the CR started. That set is larger: a CR edit that the editor made after seeing the new Main value also conflicts. Two options:

- **Option A (cheaper, approximate).** Keep `base_commit_id` + `candidate`. Compose with the latest Main on every read. Apply new edits to the composed snapshot. A field that the CR sets to the Main value is identical, and the rebase skips it (rebase.ts 152).
- **Option B (exact).** Store the CR as a list of field changes `{collection, id, field, before, after, madeAt}` with `before` = the value that the editor saw. A change conflicts when the current Main value differs from `before`. The CR view = apply the list onto the latest Main. This drops `candidate`, rebase and resolve, and adds about 150 lines of new pure code.

Option B matches the owner rule. Option A reuses more code. The spec must pick one.

---

## C. Engine: loop states and breakdowns

The engine is `src/server/loops/engine/index.ts` (614 lines): `deriveLoop` (92-476) runs the act state machine and the 7 breakdown rules with business-day counts; `deriveProject` (477-614) derives milestones (524-570) and counts.

### C.1 Dependents

| Area | Files and lines |
|---|---|
| Contracts | `src/contracts/engine.ts` (whole file); `graph.ts` `ActTypeSchema` 14-26, `DueSchema`, `hedged`, `customer`/`performer` on acts and loops, `replyWindowDays`/`acceptWindowDays`/`hedgeWindowDays`/`atRiskWindowDays` 116-119 and 209-228; `proposals.ts` `effects` 107-115; `mcp.ts` `ListLoopsInputSchema` states 162-180, `GetGraphResultSchema` 152-161, `GetLoopResultSchema` 189-193, `ListMilestonesResultSchema`; `views.ts` `engine` 27; `layout.ts` `breakdownMarkers` 69, tones, `endKind`; `domain.ts` 52-57 |
| Server | `src/server/domain/graph/read.ts` (`bindView` 52-67, `getGraphView` 83, `getGraph` 159, `listLoops` 173, `getLoop` 199, `listMilestones` 237); `domain/graph/hydrate.ts` 59-89 (records into engine input); `domain/proposals/review.ts` `loopEffects` 24-46, two `deriveProject` calls 75-78; `src/server/mcp/tools.ts` `get_graph` 154, `list_loops` 168, `get_loop` 175 (description names breakdowns at 179), `list_milestones` 182; REST `api/v1/projects/[projectId]/graph`, `loops/[loopId]` |
| Layout | `src/lib/graph-layout/index.ts`: `GLYPH`/`ACT_LABEL` per act type 40-65, `BREAKDOWN_LABEL` 66, `FIRM` 75, `endOf` 110, `hedgeIntervals` 119, `segmentsOf` tones from state and severity 137-201, `mergeAcceptIndex` 237, task counts 357-366, `breakdownMarkers` 396-405, milestone `currentDate`/status 480-510; `display.ts`, `offsets.ts` (1 reference each) |
| UI | `components/graph/labels.ts` (`BREAKDOWN_LABEL` 23, `STATE_COLOR` 32, `stateLabel` 55, `problemTone` 123-135, `problemCounts` 137-153, loop tone 156-161); `filters.ts` (state, breakdown, problems 15-17, 30-32, 82-85); `FilterBar.tsx` (Problems only 111-120, state and problem selects 169-196); `LoopList.tsx` (Problems column 59, 94-105); `LoopPanel.tsx` (state badge 337-341, problems 343-361, hedged 504, task states 107-130, 718); `MilestonePanel.tsx` 82-85; `MilestoneNode.tsx` old statuses 21-59; `ProblemTag.tsx`; `BranchEdge.tsx` markers 134; `Legend.tsx`; `GraphScreen.tsx` (engine.loops 109, 159, 274-302; counts 418-420); `review/EffectsTable.tsx`; `review/describe.ts` 227; `review/ActEditor.tsx` (act types, due, hedged, citation) |
| Tests | `tests/unit/engine/engine.test.ts` (23), `rules-v12.test.ts` (7), `tests/support/engine-builders.ts`, `tests/unit/fixtures/fixtures.test.ts` (14), `tests/unit/layout/*.test.ts` (layout 24, cards 10, day-widths 9, display 7, offsets 10, handoffs 8, benchmark 1), `tests/unit/graph/filters.test.ts` (8), `labels.test.ts` (7), `tests/integration/graph/read.test.ts`, `proposals/lifecycle.test.ts`, `seed/seed.test.ts`, `tests/e2e/graph.spec.ts`, `release.spec.ts`, `review.spec.ts` |
| Fixtures and eval | `fixtures/gold.json` (states and breakdowns per loop), `fixtures/story-source.json` (`expect` fields), `scripts/build-fixtures.ts`, `eval/metrics.ts`, `eval/fixtures.eval.ts` (transition and breakdown accuracy) |

### C.2 What to delete or rewrite

| Delete | Rewrite |
|---|---|
| `src/server/loops/engine/index.ts`; `src/contracts/engine.ts` (keep the 5-value `MilestoneStatusSchema` from `e6e6c67` in a new file) | A new pure status function (about 150 lines): work item status from its `plannedFinish` and its Done event; milestone status from its work items (port of `e6e6c67`) |
| Act types, `Due`, `hedged`, `customer`/`performer`, `pendingTerms`, nudges, the 4 day-window context fields | `GraphContextSchema`, `ActSchema` into `EventSchema` (8 kinds), `LoopSchema` into `WorkItemSchema` |
| `ProposalReview.effects`, `EffectsTable.tsx`, `ProblemTag.tsx`, Problems filter, problem counts | `filters.ts`, `FilterBar.tsx`, `labels.ts`, `LoopList.tsx`, `LoopPanel.tsx`, `MilestonePanel.tsx`, `MilestoneNode.tsx`, `Legend.tsx` |
| `tests/unit/engine/*`, `engine-builders.ts`, `eval/*`, `gold.json` | `layout.ts` contract and `graph-layout/index.ts` (input changes from `EngineOutput` to the derived tracker model) |
| MCP `list_loops`/`get_loop` breakdown wording | MCP read tools on work items |

---

## D. Users, projects and permissions

### D.1 What exists

- **Google OIDC.** Direct authorization code flow, no library: `src/server/http/google.ts` (`googleClient` 40, scope `openid profile email` 51, `startGoogleSignIn` 94, `completeGoogleSignIn` 139); routes `src/app/api/auth/google/route.ts` and `.../callback/route.ts`.
- **Session.** HMAC-signed cookie `pg_session`, 7 days (`src/server/http/session.ts` 7-8, `signSession` 25, `readSession` 29). `AUTH_MODE=local` gives a loopback-only dev sign-in with a label per e2e spec (`session.ts` 62-104, `src/server/env.ts` 10-45).
- **Provisioning.** The first sign-in creates the user, a "Personal workspace" and its membership in one transaction (`src/server/db/identity-store.ts` 17-45). The hook `seedOnUserCreated` copies the Larkspur demo into that workspace (`src/server/app.ts` 22-32, `src/server/domain/seed/index.ts` `seedSandbox` 299). This is the per-user sandbox.
- **Access.** Workspace membership decides access on every call (`src/server/db/tx.ts` `findProjectForActor` 30-57; `identity-store.ts` `resolveProject` 69-87; `domain/projects/index.ts` `listProjects` 130-150).
- **Roles.** None. Every browser user gets all 4 scopes, `graph:merge` included (`src/server/http/identity-store.ts` 48-53, `src/server/http/actors.ts` 52-59). An agent token belongs to one user and one project; its default scopes exclude `graph:merge` (`src/contracts/identity.ts` 17-21).
- **Concurrency.** Writes lock the project row (`lockProject`, tx.ts 58-60), check `expectedProposalRevision`, and replay idempotency receipts (`src/server/db/receipts.ts`). The browser gets no push: no SSE, no WebSocket. Screens reload with `router.refresh()`.

### D.2 Several people on the same project

The code supports it only in theory. Two users who share a `workspace_members` row see the same projects and the same drafts. No API, page or MCP tool adds a member. Only tests insert rows (`tests/integration/db/projects.test.ts:141`). The home page tells a user without projects to "ask a workspace owner to add you" (`src/app/(app)/page.tsx` 17-18), but no workspace owner exists. The UI shows another author as "a workspace member" because no code reads `users.name` (`src/components/review/ProposalFrame.tsx` 31-46). Any member can merge or close any draft.

### D.3 What is missing

| Need | Missing piece |
|---|---|
| Project membership, "everyone in the project can view" | `project_members(project_id, user_id, role)`, an invite by email (`users.email` exists) and an accept step at sign-in; access checks in `tx.ts` 30-57, `identity-store.ts` 69-87 and `listProjects` that join project members instead of workspace members |
| Main owner | `projects.owner_user_id` (or role `owner`); merge, request changes and close-without-merge check it; `graph:merge` leaves browser default scopes |
| Per-CR edit permission | `cr_shares(cr_id, user_id, permission edit/view)`; the author has edit; `updateProposal`, close and mark-ready check it |
| Single-editor lock | `graph_proposals.editor_user_id`; `cr_edit_requests(cr_id, requester_id, status pending/handed_over/declined, created_at, answered_at)`; every CR write checks `ctx.userId === editor_user_id` in the same transaction |
| CR states | `ready` in the status enum (`proposals.ts` 39, schema 248); "Edit again" to unlock; "Request changes" returns to draft with a note |
| Conversation and per-change comments | `cr_comments(id, cr_id, author, body, change_key nullable, created_at)` |
| Names | A members read model (user id to name and email) for History, comments, date moves and "Ask to edit" |
| Live handover | Polling (for example every 5 to 10 s on an open CR) or SSE; nothing exists today |

---

## E. UI, rendering and MCP

### E.1 Routes (`src/app`)

| Route | File | Role today |
|---|---|---|
| `/` | `(app)/page.tsx` | Redirect to the first project graph |
| `/signin` | `signin/page.tsx` | Google button (local button in dev) |
| `/projects/[id]/graph` | `(app)/projects/[id]/graph/page.tsx` | Main graph (read-only; an edit opens a draft, 117-121); `?proposal=` shows a change set graph (`ProposalGraph`, 128-234) |
| `/projects/[id]/review` | `review/page.tsx`, `change-set-detail.tsx`, `record-detail.tsx` | Queue with tabs `sets` and `records`; change set detail: title with Reject and Approve, What changes (`DiffView`), embedded read-only graph, effects, cited sources |
| `/projects/[id]/proposals/[proposalId]` | `proposals/[proposalId]/page.tsx` | Change set workspace: `ProposalWorkspace`, `LoopEditor`, `ActEditor`, `ContextEditor` |
| `.../proposals/[proposalId]/rebase` | `rebase/page.tsx` | `RebaseConflictView`: one choice per conflicting entity |
| `.../proposals`, `.../proposals/[id]/review` | redirects | to `/review` |
| `/projects/[id]/history`, `/history/[commitId]` | `history-screen.tsx` | `CommitRail`, `CommitDiff`, `RevertRestorePreview` |
| `/projects/[id]/inbox`, `/records/[versionId]` | `inbox/page.tsx`, `records/...` | All records, record text with citation selection |
| `/projects/[id]/settings/tokens` | `settings/tokens/page.tsx` | Agent tokens, MCP snippet |

The rail shows Graph, Review and Settings only (`src/components/shell/Rail.tsx` 48-56). History and Inbox exist but the rail does not link them. REST: 30 route files under `src/app/api/v1/projects/**`, built with `route()` and `domain()` (`src/server/http/route.ts` 68-100). MCP: `src/app/mcp/route.ts`.

### E.2 Graph rendering

- **React Flow** (`@xyflow/react` 12.12.0) hosts the canvas: `src/components/graph/PromiseGraph.tsx` (1,163 lines; `nodeTypes` 77, `edgeTypes` 84, `<ReactFlow>` 1063). Custom nodes: `ActNode`, `CardNode` (event cards), `GatewayNode`, `MilestoneNode`, `LaneLabel`; custom edge `BranchEdge` (SVG paths from the layout). Extra parts: `TimeAxis`, `LaneColumn` (resizable lanes), `CanvasControls`, `HoverCard`, `LoopIndex`.
- **Layout is pure TypeScript** in `src/lib/graph-layout`: `index.ts` `layoutPromiseGraph(engine, {context}, options)` (244-541): time scale with resizable day widths (`time.ts` 59), lanes per department with vendor lanes above the trunk and client lanes below, **sub-row packing** so several loops share one row (`packRows` 221), card shelves (`cards.ts`), task gateways and handoff connectors (`handoffs.ts` `linkTasks`), screen-space mapping for zoom-out (`display.ts` `displayY` 31, `displayLayout` 93), viewport math (`viewport.ts`), display-only drag offsets (`offsets.ts`, stored in localStorage by `components/graph/offset-store.ts`).
- `GraphScreen.tsx` (575 lines) owns filters, selection, panels and calls `layoutPromiseGraph` (206). Panels: `LoopPanel` (777 lines), `MilestonePanel`, `RecordPreview`, `LoopList`, `FilterBar`, `GraphHeader`, `Legend`, `EmptyGraph`.
- Drag today moves an act inside its day or shifts a whole branch. The drag changes display offsets only, never data.

### E.3 Review and proposal screens

- Main is read-only already: `useDraftEdit` creates a draft from the shown Main, then applies the edit (`src/components/review/draft-edit.ts` 7-16, 52-61). Record decisions go into one draft titled "My review" per user (`components/review-queue/state.ts` 23-37).
- The change set state badge is ready, needs-refresh, needs-update or conflict (`state.ts` 4-21). Approve calls `/merge`, Reject calls `/close`, Update calls `/rebase-preview` then `/rebase` (`components/review-queue/ChangeSetActions.tsx` 59-137).
- `DiffView.tsx` and `describe.ts` (343 lines) turn entity changes into plain sentences. `change-set-graph.ts` picks the steps to focus in the embedded graph.

### E.4 Project switcher and New project (direction-b)

`be144e8` added `components/shell/ProjectSwitcher.tsx`, `NewProjectDialog.tsx`, `new-project.ts` and `POST /api/v1/projects` (`createEmptyProject`, `domain/projects/index.ts` 121-129). It also fixed `route()` for routes without dynamic segments (`src/server/http/route.ts`). A new project starts from `emptySnapshot` (`projects/index.ts` 28-54) with **no departments**. No browser screen adds a department: `ContextEditor.tsx` adds people and milestones only (41-50). A user can create a project but cannot create its lanes without MCP.

### E.5 MCP tools (`src/server/mcp/tools.ts`, 24 tools)

| Scope | Tools (line) |
|---|---|
| `project:read` | `get_project` 119, `list_inbox` 133, `search_records` 140, `get_record` 147, `get_graph` 154, `get_snapshot` 161, `list_loops` 168, `get_loop` 175, `list_milestones` 182, `list_history` 189, `get_commit` 196, `get_proposal` 220, `diff_proposal` 228, `preview_rebase` 236, `preview_revert` 267, `preview_restore` 275 |
| `records:import` | `import_records` 126 |
| `graph:propose` | `create_proposal` 204, `update_proposal` 212, `apply_rebase` 244, `close_proposal` 252 |
| `graph:merge` | `merge_proposal` 260, `revert_commit` 283, `restore_commit` 290 |

The server text marks record text and tool output as untrusted data (`src/server/mcp/server.ts` 18). Results stay under 50,000 characters, so diffs return keys and counts (`mcp.ts` 229-247, `src/server/mcp/diff-summary.ts`).

---

## F. Tests and fixtures

### F.1 Counts

- Vitest: **69 files** (51 unit, 18 integration) under `tests/**/*.test.ts` (`vitest.config.ts`). The last recorded run (`scratchpad/cs/vitest-r2.log`, 2026-10-16 10:39) reads `Test Files 68 passed (68)`, `Tests 600 passed (600)`. `be144e8` then added `tests/unit/shell/new-project.test.ts` (3 tests), so the count now is about 603. Integration tests skip without `TEST_DATABASE_URL`.
- Eval: 1 file, 7 metrics (`eval/fixtures.eval.ts`, `eval/metrics.ts`).
- Playwright: **6 specs, about 67 tests**: `graph.spec.ts` 29, `review-queue.spec.ts` 13, `release.spec.ts` 12 (ignored by `playwright.config.ts` 19; it runs against a deployment), `review.spec.ts` 6, `shell.spec.ts` 5, `inbox.spec.ts` 2. The last default run (`e2e-r2-final.log`, 10:44) reads `53 passed`; `be144e8` added 2 shell tests.

### F.2 Larkspur fixtures

`fixtures/story-source.json` (2,490 lines) is the only hand-edited input. `scripts/build-fixtures.ts` (751 lines) generates `records.json` (137 Larkspur records + 3 isolation), `main-snapshot.json` (36 loops, 130 acts), `history.json` (merge, merge, revert), `proposals.json` (2 competing title drafts, 1 agent draft), `gold.json` (states and breakdowns at `T = 2026-10-09T18:00:00+07:00`) and `project.json`. IDs come from `uuidFromKey`. `seedLarkspur` (seed/index.ts 219) and `seedSandbox` (299) replay the story through ingest, proposal, review, merge and revert, so the seed exercises the real domain path. Everything in the story is loops, acts and record citations.

### F.3 What breaks under the new model

| Group | Files (tests) | Outcome |
|---|---|---|
| Keep with no change | `tests/unit/auth/*` (9 files, 71), `release/*` (11), `shell/*` (5), `graph/time` (3), `layout/viewport` (8), `integration/db/app`, `migrate-script`, `receipts`, `identity-store` (16) | About 115 tests stay green |
| Adapt | `integration/db/projects` (membership), `scoped-references`, `security` (seeded data), `proposals/lifecycle`, `proposals/merge`, `adapters/rest`, `adapters/mcp`, `unit/proposals/*`, `graph/references`, `graph/offset-store`, `settings/scopes`, `layout/day-widths`, `cards`, `offsets`, `display` | New entity shapes, CR states, permissions |
| Rewrite | `unit/versioning/*` (41, field-level), `integration/history/rebase` (7), `layout/layout` (24), `layout/handoffs` (8), `layout/benchmark`, `graph/filters`, `graph/labels`, `review/operations` (19), `review/describe`, `review-queue/state`, `contracts/*` except markers (27), `fixtures/fixtures` (14), `integration/graph/read` (13), `seed/seed` (6), all e2e specs | New model behavior |
| Delete | `engine/*` (30), `eval/*`, `citations/validate` (13), `evidence/normalize`, `graph/quote-context`, `source-app`, `source-link`, `inbox/*`, `review/note-view`, `contracts/markers`, `integration/evidence/*` (27), `integration/inbox` (8), `history/revert-restore` (14, if revert leaves scope) | No promise engine, no records, no notes |

About 115 of 603 vitest tests survive unchanged. Every e2e spec needs a rewrite, because each one walks the Larkspur loops.

---

## G. Recommendation

### G.1 Target model on the existing storage

Snapshot `schemaVersion: 2`, still one JSON document per commit and per CR:

- `context`: `timeZone`, `windowStart`, `windowEnd`, `asOfOverride` (keeps demos stable), `teams` (rename of departments; drop `side`), `milestones` (`id`, `name`, `order`, `plannedDate`, `originalDate`), `people` (optional).
- `workItems`: `id`, `title`, `teamId`, `milestoneId | null`, `parentId | null`, `afterIds[]`, `plannedFinish`, `originalPlannedFinish`, `queueItemId | null`.
- `events`: `id`, `kind` (message, task, handoff, decision, meeting, delivery, issue, done), `workItemId`, `at`, `title`, `body`, `by`, `queueItemId | null`.
- `dateMoves`: `id`, `target {kind: workItem | milestone, id}`, `from`, `to`, `reason` (required, not empty), `by` (ActorReference), `at`.
- Derived, not stored: status of each work item and milestone (5 values), done = has a Done event.
- Per-viewer and not versioned: eye toggles (hidden rows and teams), lane sizes, day widths. Store them in localStorage like `offset-store.ts`.

### G.2 Area by area

| Area | Action | Size | Main files |
|---|---|---|---|
| Branch base | Start from direction-b (clean on `origin/main`); port `e6e6c67` milestone logic by hand; leave local `main` alone | S | git only |
| Snapshot contracts | Change: v2 entities, operations, diff collections, MCP pages | M | `src/contracts/graph.ts`, `mcp.ts`, `views.ts`, `layout.ts`, `domain.ts` |
| Promise engine | Delete; new pure status function | S | delete `src/server/loops/engine/index.ts`, `src/contracts/engine.ts`; new `src/server/tracker/status.ts` |
| Records and inbox | Delete records, record versions, citations, quotes, `evidence_revision` | M | `src/server/domain/records/*`, `domain/inbox/*`, `graph/validate.ts` citation parts, `contracts/records.ts`, about 40 files that read `evidenceRevision`, `components/inbox/*`, inbox and records pages |
| Queue | New table `queue_items(id, project_id, kind, payload, added_by, created_at, dismissed_at)`; placement state derived from `queueItemId` on Main entities, like `countPending` derives pending records | M | new `src/server/domain/queue/*`, REST, MCP `add_to_queue`/`list_queue`, Queue panel |
| Versioning core | Keep diff/rebase/resolve/apply-operations; change the conflict key to field level (option A) or replace with a change list (option B) | M | `src/server/graph/diff.ts`, `rebase.ts`, `resolve.ts`, `apply-operations.ts`, `references.ts` |
| Change requests | Change `graph_proposals`: status `ready`, `editor_user_id`, compose with latest Main on read, merge against latest Main with recorded resolutions; drop the rebase step and the review digest `T` and evidence parts | L | `src/server/domain/proposals/*`, `db/schema.ts`, new migration `0004`, REST `proposals/**` |
| Share, lock, comments | New tables `cr_shares`, `cr_edit_requests`, `cr_comments`; server checks in every CR write; polling for "Ask to edit" | M | new domain module, `ChangeSetActions.tsx` successor |
| Membership and Main owner | New `project_members` (+ invites), `projects.owner_user_id`; access checks on project members; members read model for names | M | `src/server/db/tx.ts`, `db/identity-store.ts`, `http/actors.ts`, `http/identity-store.ts`, `domain/projects/index.ts` |
| History | Keep commits and pages; add CR link, merger and resolutions (new `graph_commits.resolutions` JSONB); drop revert and restore if the owner agrees | S | `history-screen.tsx`, `CommitRail.tsx`, `CommitDiff.tsx`, `domain/commits/history.ts`; delete `RevertRestorePreview.tsx`, `commits/revert.ts`, `restore.ts`, `preview.ts` |
| Graph layout | Change: one row per work item (drop `packRows`), teams as lanes in order (drop the vendor/client split), hidden parent as a thin strip, planned-finish flag and original-date baseline, tones from status; keep time scale, cards, viewport, display, offsets, handoff drawing | L | `src/lib/graph-layout/index.ts`, `display.ts`, `handoffs.ts` |
| Graph UI | Change and new: 8 event icons on `CardNode`/`ActNode`, `BranchEdge` tones, `WorkItemPanel` from `LoopPanel`, `MilestonePanel` (port `e6e6c67`), filters and list rewrite, eye toggles, date move with reason, Queue panel with drag onto team, milestone and work item | L | `src/components/graph/*` |
| CR review screen | Change `change-set-detail.tsx` into tabs Changes (text diff), On the graph (before/after), Conversation; per-change comments; resolve step at merge (reuse the per-item choice of `RebaseConflictView.tsx`); Merge, Request changes, Close | M | `src/app/(app)/projects/[id]/review/*`, `components/review/DiffView.tsx`, `describe.ts` |
| Old review parts | Delete `EffectsTable`, `CitedSources`, `ActEditor`, rebase page, My review logic, inbox and records pages | S | `components/review/*`, `components/review-queue/*`, `app/(app)/projects/[id]/{inbox,records,proposals/[proposalId]/rebase}` |
| Project creation | Keep the switcher and dialog; add team creation (no browser path exists today); make the creator the Main owner | S | `components/shell/*`, `ContextEditor.tsx` |
| MCP | Change: queue tools, work item reads, CR tools (create, update under the lock, mark ready, diff, comment); remove rebase, revert, restore; merge stays owner-only in the browser | M | `src/server/mcp/tools.ts`, `contracts/mcp.ts`, `docs/mcp-agent-recipe.md` |
| Fixtures and seed | Rewrite the Larkspur story as teams, work items, events, date moves and 2 competing CRs; keep the seed-through-domain pattern | M | `fixtures/story-source.json`, `scripts/build-fixtures.ts`, `src/server/domain/seed/index.ts` |
| Database | New migration: drop `records`, `record_versions`, `projects.evidence_revision`; add new tables and columns; reset existing data, because v1 snapshots fail the v2 schema | S | `src/server/db/migrations/0004_*.sql`, `schema.ts` |
| Tests | Rewrite and delete per F.3 | L | `tests/**` |

The v8 proposal page (`tropicbird/docs/design/2026-10-16-event-tracker-v8.html`, section 5) estimates 6.5 days without tests. The table above adds the records removal, membership, fixtures and tests. Expect more than that estimate.

### G.3 Cheapest path

1. Branch from `phucluu/direction-b`. It is equal to `origin/main` plus 56 commits.
2. Keep the storage pattern: `graph_commits` as Main history, `graph_proposals` as change requests, one full snapshot per version, `put`/`remove` operations, the project row lock, revisions and idempotency receipts, `insertCommit` + `advanceMain` in the merge transaction.
3. Replace the snapshot content (v2) and the engine (a small status function). Port the 5-status milestone code from `e6e6c67`, and apply the same function to each work item against its own `plannedFinish`.
4. Make a CR a proposal with one more status (`ready`) and 3 small tables (shares, edit requests, comments). Compose every CR view as latest Main plus the CR changes. Remove the Update and rebase step: the owner resolves conflicts at merge, and the merge commit stores the resolutions.
5. Change the conflict key from entity to entity + field (option A) first; it reuses `threeWayRebase` and `resolveRebase` almost line for line.
6. Keep `GraphScreen`, `PromiseGraph` and the `graph-layout` time scale, cards, viewport and display code. Rewrite only the row model and the tones in `layoutPromiseGraph`.
7. Reuse the History screen for "every merge into Main" with the CR link and resolutions.
8. Remove the records and inbox subsystem and `evidenceRevision` in one pass, before the CR work, so no later code depends on it.

### G.4 Risks

1. **Wrong base.** Local `main` (77fe22c) is a stale, unrelated docs history. A branch from it loses all app code. Use `origin/main` or direction-b.
2. **Evidence coupling.** `assertReviewBasis` (`digest.ts` 46-49) blocks a merge until the draft pins the current `evidence_revision`. If the Queue reuses records, every queue add blocks every open CR. Remove the coupling.
3. **Conflict rule.** Option A flags more conflicts than the owner rule (see B.5). Option B is exact but replaces more code. The spec must choose.
4. **Lock without push.** The app has no realtime channel. "Ask to edit", "Hand over" and "Not now" need polling or SSE. An editor who leaves holds the lock; the v8 decision says the ask waits. Agents act as their user, so the spec must say whether an agent may edit while its user holds the lock.
5. **Server-side permission checks.** Today `closeProposal` has no author check and every browser user holds `graph:merge`. Each CR write must check share, lock and owner inside the locked transaction, or two editors can still write.
6. **Data reset.** Strict v1 snapshots in `graph_commits` and `graph_proposals` fail a v2 schema. Plan a reset and a re-seed of the demo database (Render free PostgreSQL), not a data migration.
7. **Demo story.** The Larkspur fixtures, gold file, seed, eval and every e2e spec describe promises. A new story is a prerequisite for most tests.
8. **Layout height and speed.** One row per work item makes the canvas taller than sub-row packing. `tests/unit/layout/benchmark.test.ts` sets a time budget; re-measure it.
9. **Drag from the Queue.** The drop target needs the inverse of `displayY` (non-linear at low zoom) to find the team, row and date under the pointer.
10. **Names.** History, comments and date moves need user names. No member read model exists (`ProposalFrame.tsx` 31-46 prints "a workspace member").
11. **Lanes for new projects.** No browser path creates a team. A new project stays empty until this exists.
12. **Scope cut decisions.** Revert and restore, annotations, people and holidays have no role in the new model. Delete them, or the rewrite carries their tests and validation.
