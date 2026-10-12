# Promise Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an evidence inbox and versioned promise graph curated by humans/external agents, with explicit diff/merge/revert/restore and no app-hosted AI calls.

**Architecture:** One Next.js Node app exposes UI, REST and MCP over shared scoped domain functions. PostgreSQL stores immutable evidence and graph snapshots; a pure engine derives states. An optional private worker handles P1 source collection only.

**Tech Stack:** TypeScript, Node LTS, Next.js/React, Clerk, PostgreSQL/Drizzle, Zod, React Flow, Vitest/Playwright; resolved versions pinned by T02.

**Spec:** [SRD v1.1](../specs/2026-10-12-promise-graph-srd.md). **Ownership:** [task packets](../../agent-tasks/2026-10-12-promise-graph-tasks.md).

Status: plan only. No application implementation is authorized by this document itself or started in this revision.

## Global Constraints

- Imports enter inbox and leave main unchanged. No server AI calls, model SDKs/credentials, automatic graph placement, implicit merge or hidden repair calls.
- Default token scopes: project:read, records:import, graph:propose. graph:merge is explicitly granted, includes revert/restore, and cannot be self-granted.
- Graph context/settings belong in snapshots; no mutable correction/people/calendar endpoint bypasses proposals.
- P0 full snapshots: 300 loops, 3,000 acts, 1,000 record versions, 5 MiB snapshot JSON. Record text ≤65,536 UTF-8 bytes; import ≤25 records/2 MiB; update ≤100 operations/1 MiB.
- Result pages ≤50 items/50,000 characters; record chunks ≤8,000 characters with absolute UTF-16 offsets.
- Default token expiry 30 days. Reads/writes per browser user: 60/20 per minute; token calls 60 per minute.
- Immutable commits, compare-and-swap main, bounded inputs and idempotent mutation receipts; retry cannot refresh expected revisions automatically.
- Browser checks Clerk/Origin; agent checks membership/scopes/project; all protected responses private/no-store.
- External agents can explain without saving; saving graph interpretations requires valid citations and explicit proposals.
- P0 paste/MCP works without a worker or native connector credentials. Use fictional seed only.
- Deadline 18 October 2026, 23:59 Asia/Ho_Chi_Minh; aim before 18:00. Keep deployed demo available through 22 October.

## Review Focus

1. Record edited/deleted after proposal review: new pending version or masking/stale conflict, never rewritten historical quote (T06/T07/T10).
2. Two users or agents editing/merging stale inputs: one winner, explicit conflict and preserved draft (T07/T08/T11).
3. Rebase/inverse produces dangling graph references: reject with actionable conflicts rather than silently deleting evidence/links (T04/T08).
4. Wrong-project ID or revoked token replaying a receipt: reauthorize and return not-found/unauthorized before reading previous result (T02/T06/T12).
5. Large/Unicode evidence and historical context: full chunk reconstruction, exact citations, pinned snapshot identities and time (T01/T06/T10/T12).

## File map and execution boundaries

The SRD 12 directory map is the target structure. Contracts are owned by T01; shared schema/migrations/scoped repositories by T06; application boot/auth/config by T02. Pure engine, graph version algorithms and graph layout have separate owners. Domain writes are owned by proposals/history; UI and adapters never issue database writes directly.

T12 owns general REST/MCP adapter wiring. T13 adds only escalation-specific files and uses its registry extension; T12 leaves those route directories for T13. No parallel writer edits contracts/schema/route registry without the integrator coordinating a contract change. T02 uses abstract repositories for tokens until T06 supplies persistence; skeleton may deploy with auth/health only, not fake production data.

## Execution order

- Foundation: T01 first; T02/T03/T04/T05 can follow independently once schemas exist.
- Evidence: T06 publishes typed repository interfaces before dependent integration. T09 and T10 can develop UI with T05 fixtures.
- Version control: T07 first, then T08; T11 integrates review/history after those APIs exist.
- Access: T12 follows domain completion; T13 plugs escalation storage/adapters into that registry.
- Release: T14 verifies integration and deployment; T15 is optional and never blocks P0.

Estimated dates are sequencing targets, not promises of elapsed effort. Entity-level merge/conflict handling is the critical path. If it slips, cut connectors and rich UI before core version control.

## Task packets

### T01: Contracts and pure shared helpers

**Owner:** Integrator. **Target:** 12 Oct. **Depends on:** none. **Read SRD:** 0, 3–6, 8, 10, 16.

**Files — create:** `src/contracts/{identity,records,graph,proposals,engine,layout,mcp,escalations}.ts; src/lib/{calendar,record-header,canonical-json}.ts`. Test files under `tests/unit/contracts/` or `tests/integration/contracts/` unless the explicit file list names another test path. Braced paths expand into separate files/directories; ownership is exclusive except coordinated T13 adapter additions.

**Interfaces — consumes:** T01 types/schemas and the domain/repository interfaces from listed dependencies. **Produces:** `ActorContext; RecordInput/IngestReceipt/RecordChunk; GraphSnapshot/GraphOperation; Proposal/Review/Conflict; Commit/CommitReceipt; all domain Input/Result schemas named in SRD 16; canonicalHash(value): string; businessDaysBetween(a,b,calendar): number; buildRecordHeader(version,context): string`. Every input/result signature is frozen in T01 under the corresponding contract file; function implementations belong to this task’s paths.

**Deliverable:** Canonical hashes ignore object-key/entity-array ordering but retain semantic array ordering; record chunks use absolute UTF-16 offsets; operation discriminators enforce collection types and put-act quote; expected revisions and scopes are mandatory; calendar includes weekend/holiday and local midnight cases.

- [ ] **1. Write the failing cases:** Contracts reject an act without quote, duplicate entity IDs, foreign scope enum and malformed review inputs; a reordered snapshot has the same hash; Vietnamese/emoji offsets remain stable.
- [ ] **2. Run the targeted cases and confirm failure:** `pnpm test -- contracts` (or the named E2E file with `pnpm exec playwright test <file>`). Expected: tests fail for the missing behavior; not unrelated configuration failures. T01 bootstraps a minimal Vitest/package setup owned by T02 in a coordinated first commit so foundation tests are runnable; T02 completes it without parallel edits.
- [ ] **3. Implement the listed interfaces in the owned files**, using the deliverable’s fixed rules and SRD schemas; do not create a second API or substitute server AI.
- [ ] **4. Run targeted tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`**. Expected: all exit 0; quote actual summary lines. Run relevant Playwright/evaluation/live checks explicitly when the task requires them. Fixture-only T05 runs its fixture test; T14 runs the complete release checklist.
- [ ] **5. Commit only owned implementation/test files** with message `feat: t01 contracts and pure shared helpers`; report test evidence, acceptance results and unresolved integration dependencies.

### T02: Runnable application, identity and deployment

**Owner:** Integrator. **Target:** 12–13 Oct. **Depends on:** T01. **Read SRD:** 3, 12, 17.

**Files — create:** `package.json; pnpm-lock.yaml; tsconfig.json; eslint.config.mjs; next.config.ts; Dockerfile; railway.toml; .github/workflows/ci.yml; src/app/layout.tsx; src/app/page.tsx; src/server/{env.ts,http/**}; src/server/db/client.ts; src/server/domain/tokens/**; tests/integration/auth/**`. Test files under `tests/unit/auth/` or `tests/integration/auth/` unless the explicit file list names another test path. Braced paths expand into separate files/directories; ownership is exclusive except coordinated T13 adapter additions.

**Interfaces — consumes:** T01 types/schemas and the domain/repository interfaces from listed dependencies. **Produces:** `getBrowserActor(request): Promise<ActorContext>; getTokenActor(request,scope): Promise<ActorContext>; createToken(ctx,input): Promise<TokenCreated>; revokeToken(ctx,input): Promise<void>; shared error/rate-limit/Origin helpers; database connection factory`. Every input/result signature is frozen in T01 under the corresponding contract file; function implementations belong to this task’s paths.

**Deliverable:** Pin verified compatible packages; define typecheck/lint/test/eval scripts; deploy health endpoint and Google login; tokens have default read/import/propose scopes, hashed secrets and explicit merge grant; no model key or SDK and no required worker.

- [ ] **1. Write the failing cases:** Revoked/expired/member-removed tokens fail; default graph:merge denied; browser bad Origin denied; Railway health and Clerk login work; CI has no provider credentials.
- [ ] **2. Run the targeted cases and confirm failure:** `pnpm test -- auth` (or the named E2E file with `pnpm exec playwright test <file>`). Expected: tests fail for the missing behavior; not unrelated configuration failures. T01 bootstraps a minimal Vitest/package setup owned by T02 in a coordinated first commit so foundation tests are runnable; T02 completes it without parallel edits.
- [ ] **3. Implement the listed interfaces in the owned files**, using the deliverable’s fixed rules and SRD schemas; do not create a second API or substitute server AI.
- [ ] **4. Run targeted tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`**. Expected: all exit 0; quote actual summary lines. Run relevant Playwright/evaluation/live checks explicitly when the task requires them. Fixture-only T05 runs its fixture test; T14 runs the complete release checklist.
- [ ] **5. Commit only owned implementation/test files** with message `feat: t02 runnable application, identity and deployment`; report test evidence, acceptance results and unresolved integration dependencies.

### T03: Deterministic loop engine

**Owner:** Engine owner. **Target:** 12–13 Oct. **Depends on:** T01. **Read SRD:** 5.

**Files — create:** `src/server/loops/engine/**; tests/unit/engine/**`. Test files under `tests/unit/engine/` or `tests/integration/engine/` unless the explicit file list names another test path. Braced paths expand into separate files/directories; ownership is exclusive except coordinated T13 adapter additions.

**Interfaces — consumes:** T01 types/schemas and the domain/repository interfaces from listed dependencies. **Produces:** `deriveProject(input: EngineInput): EngineOutput`. Every input/result signature is frozen in T01 under the corresponding contract file; function implementations belong to this task’s paths.

**Deliverable:** Implement every act transition, original/current due date, fulfillment-cycle resets on rejection, future-act exclusion at T, stable-ID tie breaks, out_of_order handling, seven breakdown rules, due_soon and derived milestones; actor role resolves from snapshot context; engine never changes entities or links.

- [ ] **1. Write the failing cases:** Table-driven tests cover every transition row and each breakdown positive/negative; fixed snapshot plus T is deterministic even with tied occurrence/offsets; future acceptance is excluded; a rejected earlier delivery cannot hide overdue work; a later agreed date cannot erase past lateness; changed T can change warnings without changing snapshot hash.
- [ ] **2. Run the targeted cases and confirm failure:** `pnpm test -- engine` (or the named E2E file with `pnpm exec playwright test <file>`). Expected: tests fail for the missing behavior; not unrelated configuration failures. T01 bootstraps a minimal Vitest/package setup owned by T02 in a coordinated first commit so foundation tests are runnable; T02 completes it without parallel edits.
- [ ] **3. Implement the listed interfaces in the owned files**, using the deliverable’s fixed rules and SRD schemas; do not create a second API or substitute server AI.
- [ ] **4. Run targeted tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`**. Expected: all exit 0; quote actual summary lines. Run relevant Playwright/evaluation/live checks explicitly when the task requires them. Fixture-only T05 runs its fixture test; T14 runs the complete release checklist.
- [ ] **5. Commit only owned implementation/test files** with message `feat: t03 deterministic loop engine`; report test evidence, acceptance results and unresolved integration dependencies.

### T04: Pure graph diff, rebase and inverse

**Owner:** Versioning owner. **Target:** 12–13 Oct. **Depends on:** T01. **Read SRD:** 6, 16.

**Files — create:** `src/server/graph/{diff,rebase,revert,restore}.ts; tests/unit/versioning/**`. Test files under `tests/unit/versioning/` or `tests/integration/versioning/` unless the explicit file list names another test path. Braced paths expand into separate files/directories; ownership is exclusive except coordinated T13 adapter additions.

**Interfaces — consumes:** T01 types/schemas and the domain/repository interfaces from listed dependencies. **Produces:** `diffSnapshots(base: GraphSnapshot,candidate: GraphSnapshot): SnapshotDiff; threeWayRebase(base,candidate,main): RebaseResult; inverseCommit(parent,target,main): InverseResult; restoreSnapshot(target): GraphSnapshot`. Every input/result signature is frozen in T01 under the corresponding contract file; function implementations belong to this task’s paths.

**Deliverable:** Entity-level three-way comparison; context scalar fields are entities and context arrays compare by stable ID; equal edits merge, divergent/deleted edits conflict; inverse only touches target delta; restore returns copied snapshot.

- [ ] **1. Write the failing cases:** Disjoint changes survive rebase/inverse; divergent same-loop edit and delete/edit conflict; reverting a revert works; graph references are checked by validator after composition, never silently dropped.
- [ ] **2. Run the targeted cases and confirm failure:** `pnpm test -- versioning` (or the named E2E file with `pnpm exec playwright test <file>`). Expected: tests fail for the missing behavior; not unrelated configuration failures. T01 bootstraps a minimal Vitest/package setup owned by T02 in a coordinated first commit so foundation tests are runnable; T02 completes it without parallel edits.
- [ ] **3. Implement the listed interfaces in the owned files**, using the deliverable’s fixed rules and SRD schemas; do not create a second API or substitute server AI.
- [ ] **4. Run targeted tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`**. Expected: all exit 0; quote actual summary lines. Run relevant Playwright/evaluation/live checks explicitly when the task requires them. Fixture-only T05 runs its fixture test; T14 runs the complete release checklist.
- [ ] **5. Commit only owned implementation/test files** with message `feat: t04 pure graph diff, rebase and inverse`; report test evidence, acceptance results and unresolved integration dependencies.

### T05: Reviewed fictional evidence and graph fixtures

**Owner:** Fixture owner. **Target:** 12–13 Oct. **Depends on:** T01. **Read SRD:** 5, 6, 15.

**Files — create:** `fixtures/**; tests/unit/fixtures.test.ts`. Test files under `tests/unit/fixtures/` or `tests/integration/fixtures/` unless the explicit file list names another test path. Braced paths expand into separate files/directories; ownership is exclusive except coordinated T13 adapter additions.

**Interfaces — consumes:** T01 types/schemas and the domain/repository interfaces from listed dependencies. **Produces:** `fixtures/project.json; fixtures/records.json; fixtures/main-snapshot.json; fixtures/proposals.json; fixtures/history.json; fixtures/gold.json; fixtures/README.md`. Every input/result signature is frozen in T01 under the corresponding contract file; function implementations belong to this task’s paths.

**Deliverable:** Build ~120 messages/~30 loops from the SRD story, all 7 breakdowns and healthy loops; assign stable UUIDs and exact quote offsets; provide pending/ignored/new-version/withdrawn examples, conflicting proposals and inverse history; fixture expected inputs are independent of implementation.

- [ ] **1. Write the failing cases:** Every gold quote occurs at its offsets, none inside quoted ranges; source names/domains are fictional; fixture schemas pass; injection text is present as data; declared parent chain and reviewed decisions are consistent.
- [ ] **2. Run the targeted cases and confirm failure:** `pnpm test -- fixtures` (or the named E2E file with `pnpm exec playwright test <file>`). Expected: tests fail for the missing behavior; not unrelated configuration failures. T01 bootstraps a minimal Vitest/package setup owned by T02 in a coordinated first commit so foundation tests are runnable; T02 completes it without parallel edits.
- [ ] **3. Implement the listed interfaces in the owned files**, using the deliverable’s fixed rules and SRD schemas; do not create a second API or substitute server AI.
- [ ] **4. Run targeted tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`**. Expected: all exit 0; quote actual summary lines. Run relevant Playwright/evaluation/live checks explicitly when the task requires them. Fixture-only T05 runs its fixture test; T14 runs the complete release checklist.
- [ ] **5. Commit only owned implementation/test files** with message `feat: t05 reviewed fictional evidence and graph fixtures`; report test evidence, acceptance results and unresolved integration dependencies.

### T06: Database, immutable ingest and evidence retrieval

**Owner:** Integrator. **Target:** 13–14 Oct. **Depends on:** T01, T02. **Read SRD:** 4, 6.1, 8, 13, 17.

**Files — create:** `src/server/db/{schema/**,migrations/**,queries/**}; src/server/domain/{projects,records}/**; tests/integration/evidence/**`. Test files under `tests/unit/evidence/` or `tests/integration/evidence/` unless the explicit file list names another test path. Braced paths expand into separate files/directories; ownership is exclusive except coordinated T13 adapter additions.

**Interfaces — consumes:** T01 types/schemas and the domain/repository interfaces from listed dependencies. **Produces:** `ingestRecords(ctx: ActorContext,input: IngestInput): Promise<IngestReceipt>; readRecordChunk(ctx,input: ReadRecordInput): Promise<RecordChunk>; createProject(ctx,input): Promise<Project>; repository transaction/lock/receipt/read APIs for T07–T13`. Every input/result signature is frozen in T01 under the corresponding contract file; function implementations belong to this task’s paths.

**Deliverable:** Create all P0 tables and scoped foreign keys; initial empty snapshot commit; normalize/version full metadata, idempotent receipts and evidence revision; chunk/search reads and source withdrawals; publish typed scoped repository interfaces for proposals, commits, tokens and escalations.

- [ ] **1. Write the failing cases:** Import leaves main identical; duplicate-only batch does not increment evidence revision; metadata-only change does; retries preserve receipt; another project cannot be read or referenced; emoji across chunks reconstructs original text; withdrawal masks historical citation reads.
- [ ] **2. Run the targeted cases and confirm failure:** `pnpm test -- evidence` (or the named E2E file with `pnpm exec playwright test <file>`). Expected: tests fail for the missing behavior; not unrelated configuration failures. T01 bootstraps a minimal Vitest/package setup owned by T02 in a coordinated first commit so foundation tests are runnable; T02 completes it without parallel edits.
- [ ] **3. Implement the listed interfaces in the owned files**, using the deliverable’s fixed rules and SRD schemas; do not create a second API or substitute server AI.
- [ ] **4. Run targeted tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`**. Expected: all exit 0; quote actual summary lines. Run relevant Playwright/evaluation/live checks explicitly when the task requires them. Fixture-only T05 runs its fixture test; T14 runs the complete release checklist.
- [ ] **5. Commit only owned implementation/test files** with message `feat: t06 database, immutable ingest and evidence retrieval`; report test evidence, acceptance results and unresolved integration dependencies.

### T07: Validated proposals, review and atomic merge

**Owner:** Versioning owner. **Target:** 14–15 Oct. **Depends on:** T02, T04, T06. **Read SRD:** 6.1–6.3, 16.

**Files — create:** `src/server/graph/validate.ts; src/server/domain/proposals/{create,update,read,review,close,merge}.ts; tests/integration/proposals/**; tests/unit/citations/**`. Test files under `tests/unit/proposals/` or `tests/integration/proposals/` unless the explicit file list names another test path. Braced paths expand into separate files/directories; ownership is exclusive except coordinated T13 adapter additions.

**Interfaces — consumes:** T01 types/schemas and the domain/repository interfaces from listed dependencies. **Produces:** `validateSnapshot(snapshot: GraphSnapshot,evidence: AuthorizedEvidence): ValidationResult; createProposal(ctx,input): Promise<Proposal>; updateProposal(ctx,input): Promise<Proposal>; reviewProposal(ctx,input): Promise<ProposalReview>; getProposal(ctx,input): Promise<Proposal>; listProposals(ctx,input): Promise<ProposalPage>; closeProposal(ctx,input): Promise<Proposal>; mergeProposal(ctx,input): Promise<CommitReceipt>`. Every input/result signature is frozen in T01 under the corresponding contract file; function implementations belong to this task’s paths.

**Deliverable:** Bounded atomic operation batches, exact quotes/references/review decisions, hash/diff digest, optimistic draft revision and idempotent merge; lock project/proposal and compare head/evidence/draft/digest before committing. Read review includes structural diff; T10 composes derived graph preview.

- [ ] **1. Write the failing cases:** Bad quotes/references/quoted text rejected with no partial draft; concurrent draft writes lose safely; simultaneous merges yield exactly one commit; stale head/evidence/review fails; default token cannot merge and explicit scoped call can.
- [ ] **2. Run the targeted cases and confirm failure:** `pnpm test -- proposals` (or the named E2E file with `pnpm exec playwright test <file>`). Expected: tests fail for the missing behavior; not unrelated configuration failures. T01 bootstraps a minimal Vitest/package setup owned by T02 in a coordinated first commit so foundation tests are runnable; T02 completes it without parallel edits.
- [ ] **3. Implement the listed interfaces in the owned files**, using the deliverable’s fixed rules and SRD schemas; do not create a second API or substitute server AI.
- [ ] **4. Run targeted tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`**. Expected: all exit 0; quote actual summary lines. Run relevant Playwright/evaluation/live checks explicitly when the task requires them. Fixture-only T05 runs its fixture test; T14 runs the complete release checklist.
- [ ] **5. Commit only owned implementation/test files** with message `feat: t07 validated proposals, review and atomic merge`; report test evidence, acceptance results and unresolved integration dependencies.

### T08: Rebase, revert and restore transactions

**Owner:** Versioning owner. **Target:** 15–16 Oct. **Depends on:** T04, T07. **Read SRD:** 6.4–6.5.

**Files — create:** `src/server/domain/proposals/{rebase-preview,rebase-apply}.ts; src/server/domain/commits/**; tests/integration/history/**`. Test files under `tests/unit/history/` or `tests/integration/history/` unless the explicit file list names another test path. Braced paths expand into separate files/directories; ownership is exclusive except coordinated T13 adapter additions.

**Interfaces — consumes:** T01 types/schemas and the domain/repository interfaces from listed dependencies. **Produces:** `previewRebase(ctx,input): Promise<RebasePreview>; applyRebase(ctx,input): Promise<Proposal>; previewRevert(ctx,input): Promise<CommitPreview>; revertCommit(ctx,input): Promise<CommitReceipt>; previewRestore(ctx,input): Promise<CommitPreview>; restoreCommit(ctx,input): Promise<CommitReceipt>; listHistory(ctx,input): Promise<CommitPage>; getCommit(ctx,input): Promise<CommitView>`. Every input/result signature is frozen in T01 under the corresponding contract file; function implementations belong to this task’s paths.

**Deliverable:** Validate composed snapshots/citations, bind previews to revisions and digests; explicit conflict choices; inverse conflict creates a resolvable proposal; immutable new child commits for revert/restore; same authorized retry returns original receipt.

- [ ] **1. Write the failing cases:** Rebase preview never edits draft; stale apply fails; dangling reference conflict explained; unrelated later change survives revert; touched later change blocks revert; restore keeps history/evidence and rejects withdrawn citation; foreign history denied.
- [ ] **2. Run the targeted cases and confirm failure:** `pnpm test -- history` (or the named E2E file with `pnpm exec playwright test <file>`). Expected: tests fail for the missing behavior; not unrelated configuration failures. T01 bootstraps a minimal Vitest/package setup owned by T02 in a coordinated first commit so foundation tests are runnable; T02 completes it without parallel edits.
- [ ] **3. Implement the listed interfaces in the owned files**, using the deliverable’s fixed rules and SRD schemas; do not create a second API or substitute server AI.
- [ ] **4. Run targeted tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`**. Expected: all exit 0; quote actual summary lines. Run relevant Playwright/evaluation/live checks explicitly when the task requires them. Fixture-only T05 runs its fixture test; T14 runs the complete release checklist.
- [ ] **5. Commit only owned implementation/test files** with message `feat: t08 rebase, revert and restore transactions`; report test evidence, acceptance results and unresolved integration dependencies.

### T09: Inbox and manual import interface

**Owner:** UI owner. **Target:** 14–15 Oct. **Depends on:** T05, T06. **Read SRD:** 4.1, 7.6, 8.

**Files — create:** `src/server/domain/inbox/**; src/components/inbox/**; src/app/projects/[id]/{inbox,records}/**; tests/integration/inbox/**`. Test files under `tests/unit/inbox/` or `tests/integration/inbox/` unless the explicit file list names another test path. Braced paths expand into separate files/directories; ownership is exclusive except coordinated T13 adapter additions.

**Interfaces — consumes:** T01 types/schemas and the domain/repository interfaces from listed dependencies. **Produces:** `listInbox(ctx,input): Promise<InboxPage>; getInboxHints(ctx,input): Promise<Hint[]>; paste form and record chunk viewer; callbacks returning proposed GraphOperation[] to proposal editor`. Every input/result signature is frozen in T01 under the corresponding contract file; function implementations belong to this task’s paths.

**Deliverable:** Derive decisions per snapshot and pending/superseded/withdrawn status; show parent/thread hints only; include/ignore adds operations to a proposal; no mutable inbox reviewed flag and no automatic placement.

- [ ] **1. Write the failing cases:** Import and hint selection do not alter main; new version pending despite included old version; ignored decision requires reason; revert makes decision pending again; withdrawn referenced item remains reconciliation-needed until graph references removed.
- [ ] **2. Run the targeted cases and confirm failure:** `pnpm test -- inbox` (or the named E2E file with `pnpm exec playwright test <file>`). Expected: tests fail for the missing behavior; not unrelated configuration failures. T01 bootstraps a minimal Vitest/package setup owned by T02 in a coordinated first commit so foundation tests are runnable; T02 completes it without parallel edits.
- [ ] **3. Implement the listed interfaces in the owned files**, using the deliverable’s fixed rules and SRD schemas; do not create a second API or substitute server AI.
- [ ] **4. Run targeted tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`**. Expected: all exit 0; quote actual summary lines. Run relevant Playwright/evaluation/live checks explicitly when the task requires them. Fixture-only T05 runs its fixture test; T14 runs the complete release checklist.
- [ ] **5. Commit only owned implementation/test files** with message `feat: t09 inbox and manual import interface`; report test evidence, acceptance results and unresolved integration dependencies.

### T10: Graph query, layout and viewing

**Owner:** Engine/UI owner. **Target:** 14–16 Oct. **Depends on:** T03, T05, T06. **Read SRD:** 5, 7, 10.

**Files — create:** `src/lib/graph-layout/**; src/server/domain/graph/**; src/components/graph/**; src/app/projects/[id]/graph/**; tests/unit/layout/**; tests/integration/graph/**`. Test files under `tests/unit/graph/` or `tests/integration/graph/` unless the explicit file list names another test path. Braced paths expand into separate files/directories; ownership is exclusive except coordinated T13 adapter additions.

**Interfaces — consumes:** T01 types/schemas and the domain/repository interfaces from listed dependencies. **Produces:** `getGraph(ctx,input): Promise<GraphView>; getSnapshotPage(ctx,input): Promise<SnapshotPage>; getLoop(ctx,input): Promise<LoopView>; listLoops(ctx,input): Promise<LoopPage>; listMilestones(ctx,input): Promise<MilestonePage>; layoutPromiseGraph(engine,input,options): GraphLayout; getProject(ctx,input): Promise<ProjectView>`. Every input/result signature is frozen in T01 under the corresponding contract file; function implementations belong to this task’s paths.

**Deliverable:** Authorized hydration of immutable version metadata into engine input; main/proposal/historical read with fixed T; verified quotes masked on withdrawal; pure layout, ghost milestones, filters/list/panel/keyboard; expose input commit/evidence/T and pending coverage.

- [ ] **1. Write the failing cases:** Main/proposal snapshots distinguished; no query changes graph; history uses pinned calendar/people; withdrawn text masked in all views; 300-loop layout benchmark; keyboard selects branch and proof; first-paint timing documented.
- [ ] **2. Run the targeted cases and confirm failure:** `pnpm test -- graph` (or the named E2E file with `pnpm exec playwright test <file>`). Expected: tests fail for the missing behavior; not unrelated configuration failures. T01 bootstraps a minimal Vitest/package setup owned by T02 in a coordinated first commit so foundation tests are runnable; T02 completes it without parallel edits.
- [ ] **3. Implement the listed interfaces in the owned files**, using the deliverable’s fixed rules and SRD schemas; do not create a second API or substitute server AI.
- [ ] **4. Run targeted tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`**. Expected: all exit 0; quote actual summary lines. Run relevant Playwright/evaluation/live checks explicitly when the task requires them. Fixture-only T05 runs its fixture test; T14 runs the complete release checklist.
- [ ] **5. Commit only owned implementation/test files** with message `feat: t10 graph query, layout and viewing`; report test evidence, acceptance results and unresolved integration dependencies.

### T11: Proposal editing, review, conflict and history interface

**Owner:** UI owner. **Target:** 15–17 Oct. **Depends on:** T07, T08, T09, T10. **Read SRD:** 6, 7.6.

**Files — create:** `src/components/{review,history}/**; src/app/projects/[id]/{proposals,history}/**; tests/e2e/review.spec.ts`. Test files under `tests/unit/review/` or `tests/integration/review/` unless the explicit file list names another test path. Braced paths expand into separate files/directories; ownership is exclusive except coordinated T13 adapter additions.

**Interfaces — consumes:** T01 types/schemas and the domain/repository interfaces from listed dependencies. **Produces:** `ProposalEditor; ProposalDiffView; RebaseConflictView; CommitHistoryView; RevertRestorePreview; composition of ProposalReview with GraphView at identical T`. Every input/result signature is frozen in T01 under the corresponding contract file; function implementations belong to this task’s paths.

**Deliverable:** Edit acts/loops/people/departments/milestones/calendar and record decisions only in candidate draft; show structural and derived effects with rationale/sources; compare base/main/proposal conflicts; require explicit reviewed merge/revert/restore; expected revision failures retain draft.

- [ ] **1. Write the failing cases:** User corrects wrong link before merge; draft edits do not change main; stale merge displays conflict without data loss; resolved rebase requires fresh diff; restore preview shows removed later changes before apply; default token rights visible in settings.
- [ ] **2. Run the targeted cases and confirm failure:** `pnpm test -- review` (or the named E2E file with `pnpm exec playwright test <file>`). Expected: tests fail for the missing behavior; not unrelated configuration failures. T01 bootstraps a minimal Vitest/package setup owned by T02 in a coordinated first commit so foundation tests are runnable; T02 completes it without parallel edits.
- [ ] **3. Implement the listed interfaces in the owned files**, using the deliverable’s fixed rules and SRD schemas; do not create a second API or substitute server AI.
- [ ] **4. Run targeted tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`**. Expected: all exit 0; quote actual summary lines. Run relevant Playwright/evaluation/live checks explicitly when the task requires them. Fixture-only T05 runs its fixture test; T14 runs the complete release checklist.
- [ ] **5. Commit only owned implementation/test files** with message `feat: t11 proposal editing, review, conflict and history interface`; report test evidence, acceptance results and unresolved integration dependencies.

### T12: REST and MCP adapters

**Owner:** Integrator. **Target:** 15–17 Oct. **Depends on:** T02, T06, T07, T08, T09, T10. **Read SRD:** 3, 10–11, 17.

**Files — create:** `src/app/api/v1/**; src/app/mcp/route.ts; src/server/mcp/**; tests/integration/adapters/**; docs/mcp-agent-recipe.md`. Test files under `tests/unit/adapters/` or `tests/integration/adapters/` unless the explicit file list names another test path. Braced paths expand into separate files/directories; ownership is exclusive except coordinated T13 adapter additions.

**Interfaces — consumes:** T01 types/schemas and the domain/repository interfaces from listed dependencies. **Produces:** `Every P0 route/tool in SRD 10–11 mapped to shared domain functions; safe chunk/page cursors, bounded structured/text MCP results; registry extension hook for T13 escalation tools`. Every input/result signature is frozen in T01 under the corresponding contract file; function implementations belong to this task’s paths.

**Deliverable:** Validate identity/scopes/body/Origin; map conflicts and request IDs consistently; mutations carry expected revisions/keys; no MCP settings/admin or hidden provider invocation. Publish a reproducible external-agent read/propose/review/optional merge recipe.

- [ ] **1. Write the failing cases:** End-to-end MCP import/read/propose/diff works; default merge forbidden; granted merge explicit; revoked token replay denied; foreign IDs/history 404; reads over chunk/page limit continue without lost text or entities; same domain behavior on REST.
- [ ] **2. Run the targeted cases and confirm failure:** `pnpm test -- adapters` (or the named E2E file with `pnpm exec playwright test <file>`). Expected: tests fail for the missing behavior; not unrelated configuration failures. T01 bootstraps a minimal Vitest/package setup owned by T02 in a coordinated first commit so foundation tests are runnable; T02 completes it without parallel edits.
- [ ] **3. Implement the listed interfaces in the owned files**, using the deliverable’s fixed rules and SRD schemas; do not create a second API or substitute server AI.
- [ ] **4. Run targeted tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`**. Expected: all exit 0; quote actual summary lines. Run relevant Playwright/evaluation/live checks explicitly when the task requires them. Fixture-only T05 runs its fixture test; T14 runs the complete release checklist.
- [ ] **5. Commit only owned implementation/test files** with message `feat: t12 rest and mcp adapters`; report test evidence, acceptance results and unresolved integration dependencies.

### T13: Saved complaint analyses and answers

**Owner:** Analysis/UI owner. **Target:** 16–17 Oct. **Depends on:** T07, T10, T12. **Read SRD:** 9, 10–11.

**Files — create:** `src/server/domain/escalations/**; src/components/escalations/**; src/app/projects/[id]/escalations/**; src/server/mcp/escalations.ts; src/app/api/v1/escalations/**; src/app/api/v1/analyses/**; src/app/api/v1/projects/[id]/escalations/**; tests/integration/escalations/**`. Test files under `tests/unit/escalations/` or `tests/integration/escalations/` unless the explicit file list names another test path. Braced paths expand into separate files/directories; ownership is exclusive except coordinated T13 adapter additions.

**Interfaces — consumes:** T01 types/schemas and the domain/repository interfaces from listed dependencies. **Produces:** `openEscalation(ctx,input): Promise<Escalation>; saveEscalationAnalysis(ctx,input): Promise<AnalysisRevision>; getEscalation(ctx,input): Promise<EscalationView>; approveAnswer(ctx,input): Promise<Approval>`. Every input/result signature is frozen in T01 under the corresponding contract file; function implementations belong to this task’s paths.

**Deliverable:** Accept externally prepared or manually entered claims/answer; derive verdict from cited sets; save immutable pinned revisions, reject uncited/withdrawn acts; new revision/stale inputs clear approval; browser approval and copy/download only.

- [ ] **1. Write the failing cases:** Opening a complaint creates no analysis job; verdict matrix correct; invalid marker rejected; analysis becomes stale after head/evidence change; agent cannot approve; old approved answer cannot appear approved against new input.
- [ ] **2. Run the targeted cases and confirm failure:** `pnpm test -- escalations` (or the named E2E file with `pnpm exec playwright test <file>`). Expected: tests fail for the missing behavior; not unrelated configuration failures. T01 bootstraps a minimal Vitest/package setup owned by T02 in a coordinated first commit so foundation tests are runnable; T02 completes it without parallel edits.
- [ ] **3. Implement the listed interfaces in the owned files**, using the deliverable’s fixed rules and SRD schemas; do not create a second API or substitute server AI.
- [ ] **4. Run targeted tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`**. Expected: all exit 0; quote actual summary lines. Run relevant Playwright/evaluation/live checks explicitly when the task requires them. Fixture-only T05 runs its fixture test; T14 runs the complete release checklist.
- [ ] **5. Commit only owned implementation/test files** with message `feat: t13 saved complaint analyses and answers`; report test evidence, acceptance results and unresolved integration dependencies.

### T14: Seed, deterministic eval and release verification

**Owner:** Integrator + QA owner. **Target:** 17–18 Oct. **Depends on:** T05, T11, T12, T13. **Read SRD:** 2.2, 14–15, 17.

**Files — create:** `src/server/domain/seed/**; eval/**; tests/e2e/release.spec.ts; tests/integration/security.spec.ts; README.md; .env.example; scripts/check-no-model-dependencies.mjs`. Test files under `tests/unit/release/` or `tests/integration/release/` unless the explicit file list names another test path. Braced paths expand into separate files/directories; ownership is exclusive except coordinated T13 adapter additions.

**Interfaces — consumes:** T01 types/schemas and the domain/repository interfaces from listed dependencies. **Produces:** `seedSandbox(ctx): Promise<Project>; pnpm eval; release walkthrough and measured results`. Every input/result signature is frozen in T01 under the corresponding contract file; function implementations belong to this task’s paths.

**Deliverable:** Copy reviewed fixture graph/evidence per workspace; verify deterministic gold metrics, tenant/token/race/inverse cases and full UI/MCP path; provider-free dependency/config audit; README explains external AI and graph review, deployment and limitations.

- [ ] **1. Write the failing cases:** First login reaches seed ≤3 clicks; all 7 proofs readable; all deterministic metrics 100%; eval offline; two browser users isolated; no model SDK/key/job; deployed paste/proposal/merge/revert/restore and real external-agent proposal demo verified; keep service awake through 22 Oct.
- [ ] **2. Run the targeted cases and confirm failure:** `pnpm test -- release` (or the named E2E file with `pnpm exec playwright test <file>`). Expected: tests fail for the missing behavior; not unrelated configuration failures. T01 bootstraps a minimal Vitest/package setup owned by T02 in a coordinated first commit so foundation tests are runnable; T02 completes it without parallel edits.
- [ ] **3. Implement the listed interfaces in the owned files**, using the deliverable’s fixed rules and SRD schemas; do not create a second API or substitute server AI.
- [ ] **4. Run targeted tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`**. Expected: all exit 0; quote actual summary lines. Run relevant Playwright/evaluation/live checks explicitly when the task requires them. Fixture-only T05 runs its fixture test; T14 runs the complete release checklist.
- [ ] **5. Commit only owned implementation/test files** with message `feat: t14 seed, deterministic eval and release verification`; report test evidence, acceptance results and unresolved integration dependencies.

### T15: Optional passive native connectors (P1)

**Owner:** Connector owner. **Target:** After P0 gates. **Depends on:** T06, T12, T14. **Read SRD:** 8.2.

**Files — create:** `src/server/connectors/**; src/server/jobs/**; src/worker/main.ts; src/app/api/integrations/**; tests/integration/connectors/**`. Test files under `tests/unit/connectors/` or `tests/integration/connectors/` unless the explicit file list names another test path. Braced paths expand into separate files/directories; ownership is exclusive except coordinated T13 adapter additions.

**Interfaces — consumes:** T01 types/schemas and the domain/repository interfaces from listed dependencies. **Produces:** `ingest_slack_event/fetch_slack_scope/fetch_gmail_scope handlers calling ingestRecords only; source mappings and explicit collection opt-in`. Every input/result signature is frozen in T01 under the corresponding contract file; function implementations belong to this task’s paths.

**Deliverable:** Add verified Slack events and manual fetch first; Gmail OAuth/read-only/manual fetch later; encrypt credentials, use durable cursors and idempotent retry; scheduled inbox collection remains off by default; connector task includes settings adapters/UI ownership coordinated with T12.

- [ ] **1. Write the failing cases:** Bad signature denied; retry deduped; unknown channel ignored; selected project only; edited message new pending version; refresh error needs_reauth; no event/fetch creates an act/loop/graph commit or invokes a model.
- [ ] **2. Run the targeted cases and confirm failure:** `pnpm test -- connectors` (or the named E2E file with `pnpm exec playwright test <file>`). Expected: tests fail for the missing behavior; not unrelated configuration failures. T01 bootstraps a minimal Vitest/package setup owned by T02 in a coordinated first commit so foundation tests are runnable; T02 completes it without parallel edits.
- [ ] **3. Implement the listed interfaces in the owned files**, using the deliverable’s fixed rules and SRD schemas; do not create a second API or substitute server AI.
- [ ] **4. Run targeted tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`**. Expected: all exit 0; quote actual summary lines. Run relevant Playwright/evaluation/live checks explicitly when the task requires them. Fixture-only T05 runs its fixture test; T14 runs the complete release checklist.
- [ ] **5. Commit only owned implementation/test files** with message `feat: t15 optional passive native connectors (p1)`; report test evidence, acceptance results and unresolved integration dependencies.

## Self-review and requirement traceability

| SRD requirement | Tasks |
|---|---|
| Workspaces, tokens, explicit authority | T01/T02/T06/T12 |
| Immutable records, inbox, source withdrawal | T05/T06/T09/T10 |
| Engine, milestones and graph | T03/T05/T10 |
| Snapshot validation, proposal operations and review | T01/T04/T07/T11 |
| Merge, concurrency, idempotency and stale inputs | T06/T07/T08/T12 |
| Rebase, history, revert and restore | T04/T08/T11 |
| External-agent read/write tools and full-text retrieval | T01/T06/T12 |
| Saved analyses, answer revisions and approval | T13 |
| Deployment, seed, evaluation and release | T02/T14 |
| Optional connectors/non-AI worker | T15 |

All five Review Focus failure modes have named tests in their owning tasks. No task invokes an analysis provider. The old labeling/linking/connector-first task sequence is replaced completely. Task IDs in this version refer only to the definitions above; do not execute an old packet with the same ID.

## Release checklist

- [ ] Capture actual typecheck/lint/unit/integration/E2E/eval exit codes and summary lines.
- [ ] Gold deterministic metrics all 100%; measured timing included in README.
- [ ] Live Railway sign-in, isolation, MCP import/proposal, diff/merge/conflict/revert/restore verified.
- [ ] Real external-agent walkthrough creates a proposal; no provider key configured in app.
- [ ] Public repository contains fictional fixtures and no secrets; demo kept awake through 22 Oct.
- [ ] Pending evidence, unavailable quotes and stale analyses visibly labeled.

This deliverable is a revised specification and implementation plan. Starting implementation is a separate action; no coding agents are dispatched by the task allocation document.
