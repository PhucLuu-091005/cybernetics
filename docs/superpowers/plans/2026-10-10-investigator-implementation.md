# The Investigator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an evidence-backed investigation workspace usable by humans and authenticated MCP clients before 18 October 2026, 23:59 HCMC time.

**Architecture:** One TypeScript domain service layer serves REST and MCP adapters. PostgreSQL holds evidence, permissions, derived artifacts and leased jobs; a separate worker calls an approved analysis provider. The website consumes the REST contracts.

**Tech Stack:** pnpm, TypeScript, Next.js/React, Express, official MCP TypeScript SDK, Clerk, PostgreSQL/Drizzle, private S3-compatible storage, Zod, Vitest and Playwright.

**Spec:** [SRD](../specs/2026-10-10-investigator-srd.md). **Status:** draft planning artifact; no implementation has started. Product choices await review. The requested plan is prepared alongside the SRD; implementation starts only after that review.

## Global Constraints

- Human entry, file imports and MCP agent ingestion are P0; live source connectors are out of scope.
- Maximum 100 records/batch, 25 records/call, 1 MiB/request, 5 MiB/upload, and 5 MiB total staged text/batch.
- Evidence text maximum 65,536 UTF-8 bytes; title maximum 200 characters; clientRecordId maximum 128 characters.
- Default evidence model policy is human_only; client_shareable defaults false; restricted sources remain human-only in P0.
- Case membership contains can_read_restricted: boolean, default false.
- Scopes: cases:read, evidence:ingest, investigations:run, briefs:draft. Scopes alone do not grant case access.
- Pagination default 20, maximum 50. MCP excerpt maximum 8,192 UTF-16 characters and 64 KiB UTF-8 response.
- Citations use normalized-text UTF-16 start-inclusive/end-exclusive offsets and exact quote matches.
- P0 case bound: 200 active evidence records and 256 KiB permitted normalized input text per investigation.
- 60 read calls/minute and 20 mutation calls/minute per principal/client; maximum 2 analysis jobs concurrently per tenant.
- Worker leases 60 seconds, heartbeats every 20 seconds, maximum 3 attempts for transient failures.
- No secrets, source bodies, complete prompts or sensitive search queries in logs/audit.
- No MCP permission mutation, brief approval/download, source deletion, shell, arbitrary fetch or outbound messaging.
- No claim of source authenticity from submitted URLs or content hashes.
- All adapters use domain services; no direct adapter database queries.

## Review Focus

1. Permission changes while a job/import is in flight: deny commit/provider processing or mark output stale.
2. Restricted evidence influencing an uncited conclusion: dependency union prevents disclosure.
3. Identical imports racing and changed source content: stable receipts, new immutable versions.
4. EML quotations, date-only records and Unicode offsets: preserve provenance/precision and valid citations.
5. An MCP client with a valid identity but insufficient disclosure rights: tools never broaden access through scopes, summaries or job results.

## Planned repository structure

```text
apps/
  web/src/app/                 # login, cases, imports, timeline, briefs, access/settings
  web/src/components/          # evidence cards, source viewer, forms, job status
  web/src/lib/                 # typed API client; no local authorization decisions
  api/src/auth/                # Clerk browser/OAuth actor adapters and discovery
  api/src/rest/                # thin REST routes, uploads, reviewed download
  api/src/mcp/                 # transport, tool registry, schemas/result mapping
  api/src/server.ts            # HTTP composition, validation, limits, errors
  worker/src/                 # leases and domain job dispatch
packages/
  contracts/src/              # schemas and generated types
  db/src/                     # migrations, RLS context, repositories
  domain/src/security/        # policy and resource access
  domain/src/cases/           # case/membership/grant/coverage services
  domain/src/ingestion/       # batches, source normalization, parser adapters
  domain/src/evidence/        # search, excerpts, versions, withdrawal
  domain/src/investigation/   # snapshots, timelines, claim jobs, notes
  domain/src/briefs/          # audience generation, versions, review, download
  domain/src/jobs/            # enqueue/get/dispatch contracts
  domain/src/audit/           # metadata events
  analysis/src/              # model adapter, extraction/aggregation, validators
tests/
  fixtures/                  # fictional sources, principals and expected facts
  integration/               # PostgreSQL, REST and real transport integration
  e2e/                       # human flow and browser security behavior
infra/                       # containers, environment template, deployment docs
```

## Shared interface ownership

Task 0 owns `packages/contracts/src`; Task 1 owns `packages/db/src` and authentication/policy foundations. Other agents request contract/migration changes rather than independently redefining them. Auth adapters construct ActorContext, not tool/route handlers.

Task 0 must export Zod schemas and types for all SRD §6/§9 inputs/results. Also define `CaseSummary`, `TimelineEvent`, `Commitment`, `SnapshotResult`, `BriefResult`, `AuditEvent`, `JobStatus`, `EvidenceSearchHit`, `CoverageEntry`, `NoteResult`, `SnapshotPage`, `SourcePolicyInput`, `ClientGrantInput` and `DomainError`. Use UUID IDs and RFC3339 timestamps with explicit date precision. `JobStatus` is a discriminated union: queued/running; succeeded with permitted result IDs; failed with sanitized code/requestId.

Domain services are dependency-injected factories; implementation agents export the named service instances/interfaces listed in the SRD. All methods are Promise-returning. Service result bindings:

- cases.search → Page<CaseSummary>; cases.create → CaseSummary.
- ingestion.createBatch → {batchId, revision, expiresAt}; submit → {batchId, revision}; preview → BatchPreview; commit → ImportReceipt.
- evidence.search → Page<EvidenceSearchHit>; evidence.excerpt → EvidenceExcerpt.
- investigation.run/assessClaim → JobHandle; investigation.timeline → Page<TimelineEvent>; investigation.snapshot → SnapshotPage with permitted summary/events/commitments/claims section and opaque cursor.
- notes.add → NoteResult containing noteId/createdAt only; browser-only notes.list returns private author notes; briefs.draft → JobHandle; briefs.get → BriefResult; jobs.get → JobStatus.
- SnapshotResult includes events, commitments, claims, citations, complete dependencies, input caseRevision, input evidence IDs and model/prompt identifiers.
- BriefResult includes briefId, audience, version, bodyMarkdown, citations, state draft/reviewed/stale, snapshotId and dependency revision. Never return inaccessible dependencies.

Agent packets: [copyable assignments](../../agent-tasks/investigator-agent-assignments.md).

## Task 0 — Freeze contracts and build the runnable skeleton

**Owner:** Foundation agent. **Dependencies:** none. **Target:** 10 October.

**Files:** root package.json, pnpm-workspace.yaml, tsconfig.base.json, .env.example; packages/contracts/src/{actor,evidence,imports,investigation,briefs,jobs,errors,index}.ts; tests/fixtures/{principals,cases,evidence}.ts; apps/{api,worker,web} package scaffolds.

**Consumes:** SRD and this plan. **Produces:** shared schemas/types, service interface declarations, test fixtures, pnpm scripts `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `dev`, `db:migrate`, `db:seed`.

- [ ] Write `packages/contracts/src/contracts.test.ts`: reject forged server fields, 65,537-byte bodies, 201-character titles, 26-record submit calls, missing timestamps offsets, invalid enums and ambiguous job states; allow exact limits and date-only eventDate.
- [ ] Run `pnpm --filter @investigator/contracts test` and confirm new assertions fail before schemas are implemented.
- [ ] Implement Zod input/output schemas, DomainError shape and typed service interfaces; pin compatible current stable dependencies and runtime in lockfile. Avoid SDK major-version mixing.
- [ ] Add fictional fixtures with stable IDs and known facts, not generated assertions. Include restricted secret marker, emoji, contested dates and malicious instructions.
- [ ] Run contract tests and `pnpm typecheck`; confirm pass. Document exact verified auth/SDK versions in README.
- [ ] Commit only this task's files once verification passes.

## Task 1 — Authentication, database and policy

**Owner:** Security/data agent. **Dependencies:** Task 0. **Target:** 10–11 October.

**Files:** packages/db/src/{schema,migrations,context,repositories}.ts; packages/domain/src/security/{policy,disclosure}.ts; packages/domain/src/cases/{service,grants,coverage}.ts; packages/domain/src/audit/service.ts; apps/api/src/auth/{browser,mcp,discovery}.ts; tests/integration/{authorization,rls,oauth}.test.ts.

**Consumes:** ActorContext and contract types. **Produces:** `withActorTransaction(ctx, fn)`, `requireCaseAction(ctx, caseId, action)`, `filterEvidence(ctx, caseId, purpose)`, `authorizeArtifact(ctx, artifactId, purpose)`; cases/search/create, grant, coverage and audit services; auth adapters.

Purpose = human_read | server_analysis | agent_export | client_brief. All require current case access; additional SRD policies apply. Actions = read | ingest | investigate | draft | manage | review. RLS protects tenants; domain policy protects cases/disclosure.

- [ ] Write failing authorization tests: tenant B cannot see tenant A; sibling case denied; valid scope without grant denied; restricted membership absent denied; analysis_allowed excluded from agent_export; artifact with one hidden dependency denied without revealing its ID.
- [ ] Write `rls.test.ts`: parallel transactions alternate two tenants and never see one another's records; runtime database role cannot bypass RLS or update/delete audit events. Run tests and confirm failures.
- [ ] Implement schema/composite tenant foreign keys, least-privilege runtime role, transaction-local actor context, policy functions and metadata-only audit insert.
- [ ] Implement Clerk browser and remote MCP authentication/discovery; verify PKCE, current provider audience/resource semantics, expiry, issuer, client ID and scopes. Day-1 spike must connect an actual chosen MCP client. Document account configuration and sanitized setup steps.
- [ ] Implement cases, memberships, explicit client grants and source coverage services/browser endpoints. All permission changes increment policyRevision and invalidate brief approvals. Only tenant admins can assign restricted access, including explicit audited self-assignment; other members cannot self-elevate. The SRD does not claim restricted evidence is hidden from administrators who explicitly grant themselves access.
- [ ] Run `pnpm test:integration -- authorization rls oauth`; check all tests pass, including expired/wrong-resource token and revoked grant cases. Commit.

## Task 2 — Evidence ingestion, provenance and retrieval

**Owner:** Ingestion agent. **Dependencies:** Tasks 0–1. **Target:** 12–13 October.

**Files:** packages/domain/src/ingestion/{service,normalize,parse-json,parse-eml,parse-text}.ts; packages/domain/src/evidence/{service,versions,withdrawal}.ts; apps/api/src/rest/{imports,evidence,uploads}.ts; tests/integration/{imports,evidence,withdrawal}.test.ts; packages/domain/src/ingestion/parsers.test.ts.

**Consumes:** contracts, policy/transactions/audit. **Produces:** ingestion and evidence services in SRD §9; `parseUpload(input: {bytes, filename, mimeType}): ParsedUpload`, normalized records, duplicate-safe receipts, private original storage adapter and coverage updates.

- [ ] Write failing tests: stage is unsearchable; another principal cannot preview/commit; revoked grant at commit denies; duplicate/retried/concurrent commit returns one receipt; changed source creates immutable version; same idempotency key with changed request conflicts; same-case hidden canonical collision cannot disclose or supersede; new version retains stricter classification and resets model/sharing defaults.
- [ ] Write parser tests: TXT/MD/JSON/EML valid input, invalid JSON/EML error, HTML rendered inertly, attachment warning, quoted email preserved, timezone/date precision, Unicode normalization/offsets. Run and confirm failures.
- [ ] Implement parsers and staged service; server provenance overrides caller claims; source URLs are references only. Enforce byte/count limits on streaming HTTP uploads and MCP calls.
- [ ] Implement transactional commit with expectedRevision, unique keys, row locks and stable receipts. Keep sources and deduplication case-scoped; link exact source versions with per-link policies. Superseding an active version preserves historical citations. Re-import after withdrawal returns CONFLICT. Canonical collisions require current interface visibility at preview/commit; unavailable targets return generic NOT_FOUND without old-source metadata. New versions reset to human_only/not client-shareable and preserve stricter classification; receipt retries grant no source reads.
- [ ] Implement permitted full-text retrieval/excerpts, source version display, coverage updates and withdrawal invalidation. Add body/blob purge job required by SRD retention policy.
- [ ] Run `pnpm test:integration -- imports evidence withdrawal` and parser tests; prove no fetch occurs for supplied URLs and raw files are private. Commit.

## Task 3 — Jobs and evidence-backed investigation

**Owner:** Investigation agent. **Dependencies:** Tasks 0–2. **Target:** 13–15 October.

**Files:** packages/domain/src/jobs/{service,lease}.ts; packages/domain/src/investigation/{service,runner,notes}.ts; packages/analysis/src/{provider,extract,aggregate,validate,fake-provider}.ts; apps/worker/src/{main,dispatch}.ts; apps/api/src/rest/{investigations,jobs,notes}.ts; tests/integration/{investigation,jobs,disclosure}.test.ts.

**Consumes:** authorized evidence/transactions, contracts. **Produces:** jobs, investigation and notes services; `AnalysisProvider.extract(input): Promise<ExtractionResult>` and `aggregate(input): Promise<SnapshotResult>`; `validateCitations(result, versions)`; asynchronous run/claim assessment results.

- [ ] Write failing tests: fixture timeline contains source-backed commitment/change/counterevidence; unsupported claim is insufficient; date-only/undated events retain precision; invalid citations fail; restricted marker never reaches provider spy or MCP-derived output.
- [ ] Write race/error tests: membership/grant revoked after enqueue prevents processing; policy changes during model call prevent saving a releasable artifact; lease retry creates one snapshot; malformed response/timeout yields failed job. Confirm failures.
- [ ] Implement leased jobs, heartbeat, retries, per-tenant concurrency and current policy checks before provider call and artifact save; content-only additions yield an outdated result, while lost dependency rights prevent release. Use actor/client identities, not persisted tokens.
- [ ] Implement provider adapter and deterministic fake; bounded extraction/aggregation with exact citation spans and complete input dependency union. Model has no tools or arbitrary network capability.
- [ ] Implement snapshot/timeline/commitment/claim outputs, section-paginated snapshot retrieval, and separate private annotations excluded from all analysis/brief input. New evidence makes old snapshots outdated/viewable; access loss blocks disclosure. Claim reassessment creates a new result/snapshot; old source evidence is never overwritten.
- [ ] Run `pnpm test:integration -- investigation jobs disclosure`; run optional live-provider evaluation on fictional fixtures and record semantic failures separately from schema checks. Commit.

## Task 4 — Remote MCP adapter and agent interoperability

**Owner:** MCP agent. **Dependencies:** Tasks 0–2; can register typed placeholders while Task 3 finishes, but do not report placeholders as implemented. **Target:** 12–16 October.

**Files:** apps/api/src/mcp/{server,tools,result-mapping}.ts; tests/integration/{mcp,mcp-auth,mcp-disclosure}.test.ts; docs/mcp-client-setup.md; scripts/mcp-demo.ts.

**Consumes:** verified auth adapter and shared domain services. **Produces:** authenticated Streamable HTTP /mcp, tools listed in SRD except browser-only operations, setup and reproducible agent-import demo.

- [ ] Write failing SDK transport tests: discover exact schemas; create batch → submit → preview → commit → search → excerpt works; outputs carry real evidence IDs; retry is stable; unsupported fields rejected.
- [ ] Write authentication/disclosure tests: wrong-resource token denied; forged ctx ignored; no grant denied; hidden evidence cannot be discovered via search/timeline/jobs/briefs; prohibited permission/download tools absent. Run and confirm failures.
- [ ] Implement per-request identity binding and tool registry using domain services only. Map errors to MCP errors with sanitized codes/request IDs; structuredContent conforms to output schemas; source text explicitly untrusted.
- [ ] Enforce bounded pages/excerpts, Origin/host protections appropriate to deployed transport and rate limits. Tool annotations are hints only.
- [ ] Run `pnpm test:integration -- mcp mcp-auth mcp-disclosure`; then connect one real MCP client using OAuth and import fictional upstream records. Record actual client/version and supported workflow. Commit.

## Task 5 — Human evidence workspace

**Owner:** Frontend agent. **Dependencies:** Task 0; mocked contracts initially; Tasks 1–3 for live integration. **Target:** 12–16 October.

**Files:** apps/web/src/app/{cases,imports,settings}/ routes; apps/web/src/components/{EvidenceEntry,ImportPreview,EvidenceViewer,Timeline,CommitmentTrail,ClaimPanel,CoveragePanel,JobStatus,AccessSettings}.tsx; apps/web/src/lib/api.ts; tests/e2e/{human-flow,hostile-content,access}.spec.ts.

**Consumes:** shared contracts and REST endpoints. **Produces:** accessible human create/import/investigate/challenge workflow; owner policy/grant management; no independent policy logic.

- [ ] Write failing Playwright flow: create case → add recollection/upload → preview → commit → explicitly permit selected standard evidence for analysis → analyze → open citation → challenge claim. Assert provenance, precise dates and async states.
- [ ] Write browser tests for hostile HTML/links rendered inertly, expired session, denied case, failed job, incomplete source coverage and unsupported file errors. Run and confirm failures.
- [ ] Implement three main views: case overview/timeline; evidence entry/import/source viewer; claim inspection and brief entry points. Settings contain explicit model disclosure and per-client case grants.
- [ ] Render recorded facts, source assertions and inferences distinctly; sources remain one click away. Show stale snapshots and processing gaps instead of hiding them.
- [ ] Integrate typed API, job polling/backoff, keyboard focus and loading/empty/error states. Mock fixtures remain test-only.
- [ ] Run `pnpm test:e2e -- human-flow hostile-content access`, `pnpm typecheck` and build; visually inspect laptop and narrow viewport. Commit.

## Task 6 — Audience-specific briefs and reviewed downloads

**Owner:** Brief workflow agent. **Dependencies:** Tasks 0–3; coordinate UI ownership with Task 5. **Target:** 14–16 October.

**Files:** packages/domain/src/briefs/{service,runner,review}.ts; apps/api/src/rest/briefs.ts; apps/web/src/components/{BriefEditor,BriefReview,AudiencePreview}.tsx; tests/integration/briefs.test.ts; tests/e2e/brief-review.spec.ts.

**Consumes:** snapshots, authorized source subsets, provider, jobs, policy. **Produces:** briefs.draft/get, browser edit/review/download methods; audience preview using real policy.

Browser signatures: `briefs.edit(ctx,{caseId,briefId,expectedVersion,bodyMarkdown})`; `briefs.review(ctx,{caseId,briefId,expectedVersion,expectedHash})`; `briefs.download(ctx,{caseId,briefId,expectedVersion})`. Editing returns a new BriefResult; review returns exact review metadata; download returns reviewed Markdown only after current dependency checks.

- [ ] Write failing tests: client brief provider sees only client-shareable/model-permitted sources; internal-only evidence and uncited dependencies absent; owner approval binds exact content hash/version; edit/withdrawal/policy change blocks previous download; MCP cannot approve/download.
- [ ] Implement audience-specific generation from raw allowed source subsets, not unrestricted snapshots. If referenced snapshot has inaccessible dependencies, regenerate the brief's evidence reasoning from the subset.
- [ ] Implement draft versioning, sanitized Markdown editing, review invalidation and authenticated download. Human edits are attributed; approval means reviewed content, not verified factual truth.
- [ ] Implement internal/client preview; agent preview uses one actual selected grant identity and current policy, never a client-controlled role switch.
- [ ] Run `pnpm test:integration -- briefs` and `pnpm test:e2e -- brief-review`; verify no public object URL bypasses reviewed download. Commit.

## Task 7 — Integration, security audit and release

**Owner:** Integration/release agent. **Dependencies:** Tasks 1–6. **Target:** 16–18 October.

**Files:** apps/api/src/server.ts; infra/{Dockerfile.api,Dockerfile.worker,compose.yaml}; .github/workflows/ci.yml; README.md; docs/{deployment,security-model,demo-script,known-limitations}.md; tests/integration/release-security.test.ts; scripts/{seed,smoke}.ts.

**Consumes:** all services/adapters. **Produces:** live app and MCP endpoint, public-source documentation, reproducible tests/demo, release evidence.

- [ ] Write failing cross-adapter regression tests covering all SRD §12 scenarios and fixtures. Include concurrent tenant contexts and internal-source leakage through counts/cached outputs/job results.
- [ ] Compose real services; add deployment migrations/role setup, private storage, secret configuration, request limits, metadata-only logging and cleanup jobs. Do not silently bypass authentication to make deployment work.
- [ ] Run `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`; fix failures. Confirm migration/seed in a fresh database, not just local fixtures.
- [ ] Deploy and execute smoke tests against live REST and MCP. Verify actual OAuth client consent, wrong-resource token denial, tenant isolation, import receipt, investigation/citations, reviewed export and policy revocation.
- [ ] Record benchmarks and provider/client versions; inspect logs for secret/body leakage. Document tested guarantees and limitations, including unverified agent provenance and external-model retention.
- [ ] Rehearse 10-minute demo: disputed commitment → agent ingestion → human inspection → denied access → new evidence changes assessment → client brief review. Leave final day as submission buffer.
- [ ] Commit verified release changes; deliver live URL/repository and test evidence. Creating or submitting an external contest entry remains a separate user action/request.

## Delegation and integration order

One integrator owns root configuration, shared contracts and cross-task merges. Freeze Task 0 before independent implementation. Task 1 is the security critical path. After that, ingestion, MCP transport and frontend can progress together using contracts; analysis follows real ingestion. Briefs follow analysis/policy; release follows integrated flows.

For three implementers: (A) security/data then release, (B) ingestion then investigation, (C) MCP + frontend then briefs. This is a suggested future execution grouping, not agents dispatched now. Never run more independent writers than available isolated worktrees/task boundaries allow.

Each task must supply changed-file list, covered requirement IDs, exact verification commands/results, assumptions and unresolved blockers. Contract/migration changes require integrator review before downstream agents proceed. Do not treat partial mocks or fixture-only outputs as completed P0 features.

## Self-review / requirement traceability

| Requirements | Owning tasks |
|---|---|
| AUTH-01/02, CASE-01, AUD-01 | 0, 1, 4, 7 |
| ING-01…06, EVD-01…03 | 0, 2, 5 |
| INV-01…06 | 0, 3, 5 |
| BRF-01/02 | 1, 6 |
| MCP-01…03 | 0, 1, 4 |
| UX-01 | 5, 6 |
| OPS-01 and SRD §11/§12 | 1, 2, 3, 4, 7 |

All five Review Focus conditions have tests in their owning tasks. The live-provider/client spike is deliberately early because it can change delivery feasibility. P1 features must not displace release gates.
