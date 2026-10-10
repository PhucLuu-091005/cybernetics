# The Investigator — concise agent assignments

Draft handoff packets, 10 October 2026. Use after the user reviews the SRD and implementation plan. These assignments do not authorize implementation by themselves.

## Instructions common to every agent

Read `docs/superpowers/specs/2026-10-10-investigator-srd.md` and your task in `docs/superpowers/plans/2026-10-10-investigator-implementation.md`. Implement only the assigned scope. Use the shared contracts and domain authorization; do not redefine identity, permissions, schemas or database columns locally. Ask the integrator for contract/migration changes. Respect owned files and isolate concurrent changes in worktrees. Preserve human-entered, file-imported, agent-submitted and model-generated provenance distinctly.

Acceptance: real functionality, tests for meaningful failure modes, no secret/source content in logs, no inaccessible information in responses, and no mocks in production flows. Return a changed-file list, requirement IDs covered, verification commands/results, dependencies, and unresolved limitations. Commit only your verified task files according to repository instructions. Never claim private data is authentic simply because an agent supplies a URL.

## Agent A — contracts and foundation (Task 0)

**Mission:** Establish the runnable TypeScript monorepo and freeze shared contracts.

**Own:** root configuration, `packages/contracts`, shared fixtures. Coordinate all schema changes.

**Requirements:** export SRD inputs/results and typed service interfaces; strict server/caller field separation; pinned dependency versions; pnpm scripts; fictional two-tenant fixtures. Do not build product workflows or define alternate permission models.

**Done when:** contract boundary/limit tests and typecheck pass; downstream agents can import types and run the skeleton. Supply the frozen contract revision and exact auth/SDK versions.

## Agent B — security and data (Task 1)

**Mission:** Make browser and MCP identities trustworthy and enforce tenant/case/disclosure boundaries.

**Own:** `packages/db`, domain security/cases/audit, API auth adapters.

**Consumes:** Task 0 contracts. **Expose:** actor transactions, policy functions, cases/memberships/grants/coverage/audit services.

**Requirements:** Clerk OAuth/client binding, current grant checks, tenant RLS with non-bypass runtime role, case membership and restricted access, complete-dependency disclosure, metadata audit, exact source-policy defaults. No admin automatic restricted access; explicit audited admin grants are permitted, including self-assignment. Separate case content revisions from policy revisions.

**Done when:** real OAuth MCP client spike works; cross-tenant/case/derived-output tests pass; concurrent transactions cannot leak context; wrong-resource tokens and revoked grants fail.

## Agent C — ingestion and evidence (Task 2)

**Mission:** Accept human/file/agent evidence and preserve source history reliably.

**Own:** domain ingestion/evidence, REST uploads/imports/evidence and parser tests.

**Consumes:** Tasks 0–1. **Expose:** staged batch, submit, preview, commit, permitted search/excerpt, withdrawal and parsers.

**Requirements:** TXT/MD/JSON/EML; strict limits; server-set provenance; case-scoped canonical-source deduplication; immutable versions; commit concurrency/idempotency; default human-only evidence; canonical collisions cannot expose/replace a source hidden from that interface; new versions retain stricter classification and reset model/sharing permissions; coverage warnings; source URLs never fetched; private original files and purge.

**Done when:** all three input paths share one pipeline; same import retried/concurrently committed yields stable IDs; edited sources yield versions; malformed/hostile files fail safely; revoked permissions prevent commit.

## Agent D — investigation and jobs (Task 3)

**Mission:** Produce inspectable timelines, commitments and contested claims from permitted evidence.

**Own:** jobs/investigation/notes domain, worker, analysis adapter and validators.

**Consumes:** authorized evidence and Tasks 0–2. **Expose:** run/assess jobs, timeline, private author notes, job status, section-paginated structured snapshot results.

**Requirements:** current permission checks before provider calls and saving; complete input dependency union; exact citation spans; preserved date precision; recorded fact versus assertion/inference; notes excluded from analysis/export; outdated versus blocked snapshots distinguished; provider failures explicit; bounded inputs; leases/retries/concurrency.

**Done when:** fictional contested-deadline case has evidence and counterevidence; invalid citations fail; hidden markers never reach provider/agent; revoked/grant/policy race tests pass; retries do not duplicate snapshots.

## Agent E — MCP interoperability (Task 4)

**Mission:** Let an authenticated agent ingest and investigate through the same domain services.

**Own:** MCP adapter, protocol integration tests, client setup/demo script.

**Consumes:** contracts, verified auth and completed domain methods. **Expose:** `/mcp` with the SRD tool registry and structured schemas.

**Requirements:** Streamable HTTP; user/client/case grants; stage/preview/commit flow; schema-bound results/errors; bounded excerpts/pages; current disclosure policy; no permission, approval, download, shell, arbitrary-fetch or send tools.

**Done when:** SDK transport tests and one real OAuth client flow work; returned IDs match the human workspace; wrong token/grant and hidden-output cases fail safely. Report tested client/version, not universal compatibility.

## Agent F — human workspace (Task 5)

**Mission:** Make evidence entry and investigation usable without agent tools.

**Own:** case/import/settings pages, evidence/timeline/claim/coverage UI and typed browser API client. Coordinate brief components with Agent G.

**Consumes:** contracts and REST methods; mocks allowed only during development/tests.

**Requirements:** login, case creation, manual recollection/excerpt, upload preview/commit, explicit owner model-policy/grant controls, async investigation, citations, counterevidence, coverage/stale/error states and keyboard navigation. Server remains policy authority.

**Done when:** browser E2E completes entry → import → analyze → citation → claim challenge; hostile content is inert; no mock success states; laptop/narrow viewport inspected.

## Agent G — briefs and audience review (Task 6)

**Mission:** Produce audience-specific drafts and exact-version reviewed downloads.

**Own:** brief domain/API/UI components and tests.

**Consumes:** allowed source subsets, analysis provider/jobs and current policy.

**Requirements:** internal versus client generation from permitted raw evidence; no unrestricted-summary redaction shortcut; version/hash-bound owner review; edits/policy changes/withdrawals invalidate approval; authenticated Markdown download only; MCP may draft/read permitted briefs but cannot approve/download.

**Done when:** hidden/internal evidence cannot influence client draft; stale approvals fail; human workflow reviews then downloads the correct version; selected-agent audience preview applies actual grant policy.

## Agent H — integration and release (Task 7)

**Mission:** Deliver the integrated live application and MCP service with reproducible proof.

**Own:** server composition, deployment/CI/docs, smoke/seed scripts and cross-system regression tests. Coordinate root changes with Agent A.

**Consumes:** all task outputs.

**Requirements:** fresh migration/seed, private storage, secret configuration, all tests/build, live OAuth/MCP and human workflows, adversarial fixtures, logs checked for leakage, cleanup/retention, measured benchmarks and honest limitations.

**Done when:** live app + MCP URL + public source are usable; all P0 SRD release gates have evidence; 10-minute fictional demo rehearsed; submission buffer remains. Do not submit the contest entry or create external communications without a user request.

## Suggested dispatch waves

1. Agent A freezes contracts; Agent B starts provider/auth feasibility once interfaces are available.
2. After security foundation: Agents C, E and F can work independently within owned files.
3. Agent D follows ingestion; Agent G follows analysis; Agent F integrates their screens.
4. Agent H integrates and verifies; all feature owners fix their own defects.

Agent labels describe responsibilities, not a requirement to run eight agents or eight concurrent sessions. With three implementers, group A/B/H, C/D, and E/F/G; obey each group's dependencies. The integrator alone approves shared contract changes.
