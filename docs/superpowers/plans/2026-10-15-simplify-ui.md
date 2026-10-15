# Simpler Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Promise Graph UI three jobs (Graph, Review, Escalations), a sidebar that folds to icons, one Review queue for records and change sets, and plain words, without a change to the API, MCP, database or engine.

**Architecture:** A new project layout renders the rail and reads a `pg_rail` cookie. A new route `/projects/[id]/review` composes the existing domain reads (`listProposals`, `diffProposal`, `readInboxView`) and the existing endpoints (merge, close, rebase-preview, rebase, PATCH proposal). Old pages stay as redirects or as secondary pages. New CSS goes into `shell.css` and `review.css`, so `globals.css` (owned by the graph-polish session) does not change.

**Tech Stack:** Next.js 16 app router (server components + client components), React 19, TypeScript 5.9, Zod 4, Vitest 4 (node environment, no DOM), Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-15-simplify-ui-design.md` (mockup `docs/design/2026-10-15-simplify-ui.html`)

## Global Constraints

- No change to `src/contracts/**`, `src/server/**` (except new read-only helpers in route folders under `src/app`), `src/app/api/**`, `src/app/mcp/**`, `drizzle/**`, `fixtures/**`, the engine.
- Do not edit files owned by the graph-polish session: `src/components/graph/{GraphScreen,PromiseGraph,CanvasControls,TimeAxis,AxisMenu,LoopPanel,LoopIndex,CardNode,BranchEdge,RecordPreview,ResizeHandle}.tsx`, `src/components/graph/{labels,ui-context,offset-store,stored-size,day-width-store}.ts`, `src/lib/graph-layout/**`, `src/app/globals.css`, `tests/e2e/graph.spec.ts`. Task 9 waits for the coordination answer.
- UI words follow spec §3 exactly: "Approved graph", "Change set", "Approve", "Reject", "Activity", "Undo this change", "Go back to this version", "Update to latest", "Needs update", "Needs refresh", "As of", "Problem type", "My review", "Technical details".
- The merge request keeps every expectation field (`expectedMainCommitId`, `expectedProposalRevision`, `expectedEvidenceRevision`, `reviewDigest`, `T`). `message` = the change set title.
- Rail cookie: name `pg_rail`, values `open` | `collapsed`, `Path=/; Max-Age=31536000; SameSite=Lax`. Widths 212 px and 56 px. Mobile breakpoint 760 px.
- Code style: Prettier (single quotes, width 100), comments only for WHY.
- Commits: local only, no push. **No `Co-Authored-By` or other AI trailer** (owner rule for this repo).
- Commands: `pnpm` is not on PATH. Use `npx pnpm@11.25.0 <script>`. Integration and e2e need `TEST_DATABASE_URL` (local Postgres on `127.0.0.1:55432`, container `cybernetics-pg`).
- Gates: capture the real exit code (`cmd > log 2>&1; echo $?`) and read the summary line.

## Review Focus

1. A user with two projects folds the rail, opens the second project from the switcher: the rail stays folded and the switcher shows the second project as current. (Task 2, e2e step.)
2. A change set whose evidence moved **and** whose base is stale: the screen offers "Update to latest" first, never an Approve that fails. (Task 4 unit test `stale base wins over moved evidence`.)
3. Two tabs approve the same change set: the second Approve shows the conflict banner and keeps the screen, it does not navigate. (Task 6, `ChangeSetActions` shows `ConflictBanner` on any non-OK result; e2e step in Task 8.)
4. The user ignores a record, then the "My review" draft goes stale because another change set was approved: the next Ignore still works (it targets the same draft; the API accepts a stale-base draft update) and "My review" shows "Needs update". (Task 7 e2e step.)
5. A deep link `/projects/<id>/review?tab=sets&item=<merged or unknown id>`: an unknown id is a 404, a merged or closed id shows "This change set is no longer open" with a link to Activity. (Task 6.)

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/components/shell/rail-state.ts` | create | cookie name, parse, serialize |
| `src/components/shell/icons.tsx` | create | rail icons (Lucide paths) |
| `src/components/shell/Rail.tsx` | create | client rail: switcher, items, footer, fold |
| `src/components/shell/ProjectSwitcher.tsx` | create | `<details>` project menu |
| `src/components/shell/RailNav.tsx` | delete | replaced by `Rail.tsx` |
| `src/components/shell/ThemeToggle.tsx`, `SignOutButton.tsx` | modify | render as rail items |
| `src/app/shell.css` | create | rail, fold and mobile rules |
| `src/app/(app)/layout.tsx` | modify | auth only |
| `src/app/(app)/projects/[id]/layout.tsx` | create | shell for every project page |
| `src/app/(app)/projects/[id]/review-count.ts` | create | rail Review count |
| `src/components/graph/filters.ts` | modify | `problems` filter |
| `src/components/graph/FilterBar.tsx` | modify | search, Problems only, Filter popover |
| `src/components/graph/GraphHeader.tsx` | modify | plain header |
| `src/components/review-queue/state.ts` | create | change set state, "My review" pick, Review URLs |
| `src/components/review-queue/ChangeSetActions.tsx` | create | Approve, Reject, Update to latest, Refresh |
| `src/components/review-queue/IgnoreRecord.tsx` | create | Ignore into "My review" |
| `src/components/review-queue/QueueList.tsx` | create | tabs and item list |
| `src/components/review/CitedSources.tsx` | create | quotes block, moved out of the old review page |
| `src/app/review.css` | create | Review screen layout |
| `src/app/(app)/projects/[id]/review/page.tsx` | create | Review screen |
| `src/app/(app)/projects/[id]/review/change-set-detail.tsx` | create | server detail for a change set |
| `src/app/(app)/projects/[id]/review/record-detail.tsx` | create | server detail for a record |
| `src/app/(app)/projects/[id]/proposals/page.tsx` | modify | redirect to Review |
| `src/app/(app)/projects/[id]/proposals/[proposalId]/review/page.tsx` | modify | redirect to Review item |
| `src/components/review/MergePanel.tsx` | delete | replaced by `ChangeSetActions` |
| other pages and components in §Task 1 table | modify | words |
| `tests/unit/shell/rail-state.test.ts`, `tests/unit/review-queue/state.test.ts` | create | unit tests |
| `tests/unit/graph/filters.test.ts` | modify | problems filter tests |
| `tests/e2e/shell.spec.ts`, `tests/e2e/review-queue.spec.ts` | create | e2e |
| `tests/e2e/{inbox,review,release,escalations}.spec.ts` | modify | new words and routes |
| `README.md`, `docs/screenshots/*`, `docs/superpowers/specs/2026-10-14-ui-redesign-decisions.md` | modify | docs |

---

### Task 1: Plain words on owned screens

**Files:** every file in the table below; `tests/e2e/inbox.spec.ts`, `tests/e2e/review.spec.ts`, `tests/e2e/release.spec.ts`, `tests/e2e/escalations.spec.ts`.

**Interfaces:** Produces the copy that later tasks and e2e specs assert on. No code interface changes.

- [ ] **Step 1: Replace the strings.** Each row is an exact old string → new string in one file. Keep surrounding JSX.

| File | Old | New |
|---|---|---|
| `src/app/(app)/projects/[id]/graph/page.tsx` | `Open proposal` | `Open change set` |
| same | `The violet halo marks loops this proposal changes. Edits in the loop panel go into this` (whole sentence pair) | `The violet halo marks loops this change set changes. Edits in the loop panel go into this` (keep the rest, replace "proposal" with "change set" in the next line) |
| same | `` `Candidate graph for ${proposal.title}` `` | `` `Change set: ${proposal.title}` `` |
| `src/app/(app)/projects/[id]/history/page.tsx` | `History · Promise Graph` | `Activity · Promise Graph` |
| `src/app/(app)/projects/[id]/history/history-screen.tsx` | `<h1>History</h1>` | `<h1>Activity</h1>` |
| same | `Commits are immutable. Revert and restore create new commits on top of main, and never` … | `Each version stays. "Undo this change" and "Go back to this version" add a new version on top and never` … (rest of sentence: replace "main" with "the approved graph") |
| same | `, evidence revision` block in the status line | remove that `<span>` (evidence revision) |
| `src/components/history/RevertRestorePreview.tsx` | `` `Revert ${quoted(target.message)}` `` | `` `Undo ${quoted(target.message)}` `` |
| same | `` `Restore graph as of ${quoted(target.message)}` `` | `` `Go back to ${quoted(target.message)}` `` |
| same | `Restore` (button text, line ~173) | `Go back to this version` |
| same | `` `Revert preview for ${target.id.slice(0, 7)}` `` | `` `Undo preview` `` |
| same | `` `Restore preview: graph as of ${target.id.slice(0, 7)}` `` | `` `Go back preview` `` |
| same | `Create proposal from inverse` | `Create a change set that undoes it` |
| same | `The draft applies the inverse where it is safe and keeps main for each` | `The change set undoes what is safe to undo and keeps the approved graph for each` |
| same | `Conflict: main or the evidence moved since this page loaded.` | `Conflict: the graph or the records changed since this page loaded.` |
| same | `No commit was created. Reload to preview against the current main.` | `Nothing changed. Reload to preview again.` |
| same | `Commit message` | `Note` |
| same | `History, evidence and token settings stay. Restore is blocked when a citation in the` | `Activity, records and token settings stay. Going back is blocked when a citation in the` |
| `src/components/history/CommitRail.tsx` | `main` (badge text) | `approved` |
| any other button text `Revert` in `src/components/history/*` | `Revert` | `Undo this change` |
| `src/app/(app)/projects/[id]/inbox/page.tsx` | `<h1>Inbox</h1>` | `<h1>All records</h1>` |
| same | metadata `Inbox · Promise Graph` | `All records · Promise Graph` |
| same | `Imported records wait here. Review states come from the selected graph. Including or ignoring a record adds an operation to a proposal and never writes to main.` | `Every imported record and its state. New records are easier to handle in Review.` |
| same | `Main, read-only` | `Approved graph` |
| same | the `Head commit` and both `Evidence revision` spans | remove them |
| same | `(current main)` | `(current)` |
| same | `Open proposal` | `Open change set` |
| same | `Main view` | `Approved graph` |
| same | `Review in` / `Choose a draft` | `Show as in` / `Choose a change set` |
| same | `` `Proposal, ${proposal.status}` `` | `` `Change set, ${proposal.status === 'draft' ? 'open' : proposal.status}` `` |
| `src/components/inbox/DecisionButtons.tsx` | `Include in proposal` | `Include` |
| same | `Ignore in proposal` | `Ignore` |
| same | `'Including needs a draft with an act that cites this record. Select a span of the text and start an act.'` | `'To include it, select a quote and add an act.'` |
| same | `'No act in this draft cites this record yet. Select a span of the text and start an act.'` | `'No act in this change set cites this record yet. Select a quote and add an act.'` |
| same | `'Already included in this draft.'` | `'Already included in this change set.'` |
| same | `'Visible acts cite this record. Hide or remove them in the proposal before you ignore it.'` | `'Acts cite this record. Hide or remove them in the change set before you ignore it.'` |
| same | `'Decisions go into the selected draft.'` | `'Decisions go into the selected change set.'` |
| same | `'The first decision creates a draft from current main. Main does not change until a person merges it.'` | `'Your first decision creates the change set "My review". The graph changes when a person approves it.'` |
| same | `'This proposal is ${proposal.status}. Select a draft or main to add decisions.'` | `'This change set is closed. Select an open change set to add decisions.'` |
| same | `'Conflict: the draft or the evidence changed since this page loaded.'` | `'Conflict: the change set or the records changed since this page loaded.'` |
| `src/components/inbox/RecordViewer.tsx` | `Start act from selection` | `Add an act from this quote` |
| `src/components/inbox/PasteForm.tsx` | `Importing never changes main.` | `Importing never changes the graph.` |
| same | `Main moved since this page loaded, through another merge` | `The graph changed since this page loaded, through another approval` |
| `src/app/(app)/projects/[id]/proposals/[proposalId]/page.tsx` | metadata `Proposal · Promise Graph` | `Change set · Promise Graph` |
| same | `All proposals` | `Back to Review` (href becomes `reviewHref(id, { tab: 'sets', item: proposal.id })`, import from Task 4) |
| same | `Open in graph view` | `View on graph` |
| same | `Review changes` | `Review and approve` (href `reviewHref(id, { tab: 'sets', item: proposal.id })`) |
| same | `` Candidate graph at T = `` | `` Change set graph as of `` |
| `src/app/(app)/projects/[id]/proposals/[proposalId]/rebase/page.tsx` | metadata `Rebase · Promise Graph` | `Resolve conflict · Promise Graph` |
| same | `Rebase onto current main` (h1) | `Resolve conflict` |
| same | `` `This proposal is ${proposal.status}. Only a draft can be rebased.` `` | `` 'This change set is no longer open.' `` |
| same | `No rebase preview.` | `No preview.` |
| `src/components/review/RebaseConflictView.tsx` | `Conflict: the rebase inputs changed.` | `Conflict: the graph or the change set changed.` |
| same | `The rebase was not applied.` | `Nothing changed.` |
| same | `Your choices are kept. Preview the rebase again if main, the draft or the evidence moved.` | `Your choices are kept. Reload the page and choose again.` |
| same | `` `Your proposal r${preview.proposalRevision}` `` | `` 'Your change set' `` |
| same | `Keep main` / `Keep proposal` | `Keep approved` / `Keep change set` |
| same | `Choose a resolution for each conflict. After applying, review a fresh diff before you merge.` | `Choose one side for each conflict. Then check the changes again before you approve.` |
| same | `Apply resolutions to the draft` | `Apply my choices` |
| same | `` router.push(`/projects/${projectId}/proposals/${preview.proposalId}/review?rebased=1`) `` | `` router.push(`${reviewHref(projectId, { tab: 'sets', item: preview.proposalId })}&updated=1`) `` (import `reviewHref` from Task 4) |
| `src/components/review/ProposalFrame.tsx` | `This proposal is merged` | `This change set is approved` |
| same | `This proposal is closed. It is read-only.` | `This change set is rejected. It is read-only.` |
| same | `Merging needs a rebase onto current main.` | `The graph changed after this change set was made.` |
| same | `Preview rebase` | `Update to latest` (href `reviewHref(projectId, { tab: 'sets', item: proposal.id })`) |
| same | `(current main)` | `(current)` |
| same | badge `` `Proposal, ${status}` `` (if present) | `` `Change set, ${status === 'draft' ? 'open' : status}` `` |
| `src/components/review/ProposalWorkspace.tsx` | `Changes in this proposal` | `What changes` |
| `src/components/review/ActEditor.tsx` | `No loop (shows only in proposal previews)` | `No loop (shows only in change set previews)` |
| same | `This proposal is not a draft, so it cannot change.` | `This change set is closed, so it cannot change.` |
| `src/components/review/CreateProposalForm.tsx` | `Create proposal` (both) | `New change set` |
| same | `What this proposal changes` | `What this change set changes` |
| same | `Create draft from main` | `Create change set` |
| same | `The proposal was not created.` | `The change set was not created.` |
| same | `Conflict: main or the evidence moved since this page loaded.` | `Conflict: the graph or the records changed since this page loaded.` |
| same | `Your title and rationale are kept. Reload, then create the proposal again.` | `Your title and reason are kept. Reload, then create it again.` |
| `src/app/(app)/projects/[id]/settings/tokens/page.tsx` | metadata `Agent tokens · Promise Graph` | `Settings · Promise Graph` |
| same | `<h1>Agent tokens</h1>` | `<h1>Settings</h1>` and add `<h2>Agent access</h2>` above the token list |
| `src/components/settings/TokenCreate.tsx` | `Read records, inbox, graph, history and proposals.` | `Read records, the graph, activity and change sets.` |
| same | `Create and edit proposals. A person still merges.` | `Create and edit change sets. A person still approves.` |
| same | `Lets this token merge, revert and restore without you. Grant it only to an agent that you direct.` | `Lets this token approve and undo without you. Grant it only to an agent that you direct.` |
| `src/components/escalations/AnswerDraft.tsx` | `` `Analysis revision ${analysis.revision}, pinned graph commit ${analysis.graphCommitId.slice(0, 7)}, evidence revision ${analysis.evidenceRevision}.` `` | `` `Analysis ${analysis.revision}.` `` followed by `<details><summary>Technical details</summary>Graph version {analysis.graphCommitId.slice(0, 7)}, evidence revision {analysis.evidenceRevision}</details>` |

- [ ] **Step 2: Search for leftovers in owned files.**

Run: `grep -rnE "\b(Merge into main|Main, read-only|Head commit|Evidence revision|Include in proposal|Ignore in proposal|Create proposal|Preview rebase)\b" src/app/\(app\) src/components/{inbox,review,history,settings,escalations,shell}`
Expected: no output. `MergePanel.tsx` still matches until Task 6 deletes it; that is the only allowed hit.

- [ ] **Step 3: Update e2e selectors in `inbox.spec.ts`, `review.spec.ts`, `release.spec.ts`, `escalations.spec.ts`** to the new strings: `'Main, read-only'` → `'Approved graph'`, `'Start act from selection'` → `'Add an act from this quote'`, `'Ignore in proposal'` → `'Ignore'` (use `{ exact: true }`), `'Include in proposal'` → `'Include'` (exact), `'Proposal, draft'` → `'Change set, open'`, `'Apply resolutions to the draft'` → `'Apply my choices'`, `'Keep proposal'` → `'Keep change set'`, `'Create proposal from inverse'` → `'Create a change set that undoes it'`, `{ name: 'Commits' }` list stays (aria label unchanged). Leave merge-flow steps (`Merge into main`, `Commit message`, checkbox, `/review?rebased=1`) for Task 8.

- [ ] **Step 4: Typecheck and lint.**

Run: `npx pnpm@11.25.0 typecheck > /tmp/tc.log 2>&1; echo $?` → `0`. `npx pnpm@11.25.0 lint > /tmp/lint.log 2>&1; echo $?` → `0`.

- [ ] **Step 5: Commit.**

```bash
git add -A src/app src/components tests/e2e
git commit -m "feat: plain words on the record, change set, activity and settings screens"
```

---

### Task 2: Folding sidebar with one project and a switcher

**Files:**
- Create: `src/components/shell/rail-state.ts`, `src/components/shell/icons.tsx`, `src/components/shell/Rail.tsx`, `src/components/shell/ProjectSwitcher.tsx`, `src/app/shell.css`, `src/app/(app)/projects/[id]/layout.tsx`, `src/app/(app)/projects/[id]/review-count.ts`, `tests/unit/shell/rail-state.test.ts`, `tests/e2e/shell.spec.ts`
- Modify: `src/app/(app)/layout.tsx`, `src/components/shell/ThemeToggle.tsx`, `src/components/shell/SignOutButton.tsx`
- Delete: `src/components/shell/RailNav.tsx`

**Interfaces:**
- Produces: `RAIL_COOKIE`, `type RailState = 'open' | 'collapsed'`, `parseRailState(value: string | undefined): RailState`, `railCookie(state: RailState): string`; `<Rail projectId projects waiting initial />`; `reviewCount(db, actor, projectId): Promise<number>`.
- Consumes: `reviewHref` is not needed here; the Review link is `/projects/${id}/review`.

- [ ] **Step 1: Write the failing unit test** `tests/unit/shell/rail-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseRailState, railCookie, RAIL_COOKIE } from '../../../src/components/shell/rail-state';

describe('rail state cookie', () => {
  it('reads collapsed and treats anything else as open', () => {
    expect(parseRailState('collapsed')).toBe('collapsed');
    expect(parseRailState('open')).toBe('open');
    expect(parseRailState(undefined)).toBe('open');
    expect(parseRailState('COLLAPSED')).toBe('open');
    expect(parseRailState('collapsed; Path=/')).toBe('open');
  });
  it('writes a one-year, site-wide, lax cookie', () => {
    expect(RAIL_COOKIE).toBe('pg_rail');
    expect(railCookie('collapsed')).toBe('pg_rail=collapsed; Path=/; Max-Age=31536000; SameSite=Lax');
  });
});
```

- [ ] **Step 2: Run it.** `npx pnpm@11.25.0 test tests/unit/shell/rail-state.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement** `src/components/shell/rail-state.ts`:

```ts
export const RAIL_COOKIE = 'pg_rail';
export type RailState = 'open' | 'collapsed';

export const parseRailState = (value: string | undefined): RailState =>
  value === 'collapsed' ? 'collapsed' : 'open';

export const railCookie = (state: RailState) =>
  `${RAIL_COOKIE}=${state}; Path=/; Max-Age=31536000; SameSite=Lax`;
```

- [ ] **Step 4: Run it.** Same command → PASS (2 tests).

- [ ] **Step 5: Icons** `src/components/shell/icons.tsx`:

```tsx
const PATHS = {
  graph: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9',
  review:
    'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  settings: 'M20 7h-9M14 17H5M17 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  theme: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  signOut: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  panel: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM9 3v18',
  chevron: 'm6 9 6 6 6-6',
} as const;
export type RailIconName = keyof typeof PATHS;

export function RailIcon({ name }: { name: RailIconName }) {
  return (
    <svg
      className="rail-ic"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
```

- [ ] **Step 6: Theme and sign-out as rail items.** In `ThemeToggle.tsx` replace the returned button with:

```tsx
    <button
      className="rail-item"
      type="button"
      onClick={next}
      aria-label={`Colour theme: ${theme}. Switch theme`}
      title={`Theme: ${theme}`}
    >
      <RailIcon name="theme" />
      <span className="rail-label">Theme: {theme}</span>
    </button>
```

(import `RailIcon` from `./icons`). In `SignOutButton.tsx` replace the button with:

```tsx
    <button className="rail-item" type="button" onClick={signOut} aria-label="Sign out" title="Sign out">
      <RailIcon name="signOut" />
      <span className="rail-label">Sign out</span>
    </button>
```

- [ ] **Step 7: Project switcher** `src/components/shell/ProjectSwitcher.tsx`:

```tsx
import Link from 'next/link';
import { RailIcon } from './icons';

export type RailProject = { id: string; clientName: string; title: string };

export function ProjectSwitcher({ current, projects }: { current: RailProject; projects: RailProject[] }) {
  return (
    <details className="proj-switch">
      <summary aria-label={`Project: ${current.clientName}. Switch project`} title={current.clientName}>
        <span className="proj-avatar" aria-hidden="true">
          {current.clientName.slice(0, 1).toUpperCase()}
        </span>
        <span className="rail-label proj-names">
          <b>{current.clientName}</b>
          <small>{current.title}</small>
        </span>
        <span className="rail-label proj-caret">
          <RailIcon name="chevron" />
        </span>
      </summary>
      <ul className="proj-menu" aria-label="Projects">
        {projects.map((project) => (
          <li key={project.id}>
            <Link
              href={`/projects/${project.id}/graph`}
              aria-current={project.id === current.id ? 'true' : undefined}
            >
              <b>{project.clientName}</b>
              <small>{project.title}</small>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
```

- [ ] **Step 8: Rail** `src/components/shell/Rail.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { RailIcon, type RailIconName } from './icons';
import { ProjectSwitcher, type RailProject } from './ProjectSwitcher';
import { railCookie, type RailState } from './rail-state';
import { SignOutButton } from './SignOutButton';
import { ThemeToggle } from './ThemeToggle';

type Props = { projectId: string; projects: RailProject[]; waiting: number; initial: RailState };

export function Rail({ projectId, projects, waiting, initial }: Props) {
  const pathname = usePathname();
  const [state, setState] = useState<RailState>(initial);
  const folded = state === 'collapsed';
  const current = projects.find((project) => project.id === projectId)!;
  const base = `/projects/${projectId}`;
  const toggle = () => {
    const next: RailState = folded ? 'open' : 'collapsed';
    setState(next);
    document.cookie = railCookie(next);
  };
  const item = (path: string, icon: RailIconName, label: string, count = 0) => {
    const href = `${base}/${path}`;
    const active = pathname === href || pathname.startsWith(`${href}/`);
    const name = count > 0 ? `${label}, ${count} waiting` : label;
    return (
      <Link
        className="rail-item"
        href={href}
        aria-current={active ? 'page' : undefined}
        aria-label={name}
        title={folded ? name : undefined}
        data-dot={count > 0 ? '' : undefined}
      >
        <RailIcon name={icon} />
        <span className="rail-label">{label}</span>
        {count > 0 && <span className="rail-count rail-label">{count}</span>}
      </Link>
    );
  };
  return (
    <div className="rail" data-state={state}>
      <ProjectSwitcher current={current} projects={projects} />
      <nav className="rail-nav" aria-label="Project">
        {item('graph', 'graph', 'Graph')}
        {item('review', 'review', 'Review', waiting)}
        {item('escalations', 'flag', 'Escalations')}
      </nav>
      <div className="rail-foot">
        <p className="rail-note rail-label">Nothing changes the graph until a person approves it.</p>
        {item('settings/tokens', 'settings', 'Settings')}
        <ThemeToggle />
        <SignOutButton />
        <button
          className="rail-item rail-fold"
          type="button"
          onClick={toggle}
          aria-expanded={!folded}
          aria-label={folded ? 'Expand sidebar' : 'Collapse sidebar'}
          title={folded ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <RailIcon name="panel" />
          <span className="rail-label">Collapse sidebar</span>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Review count** `src/app/(app)/projects/[id]/review-count.ts`:

```ts
import type { ActorContext } from '../../../../contracts';
import type { Db } from '../../../../server/db';
import { resolveView } from '../../../../server/domain/graph';
import { countPending } from '../../../../server/domain/inbox';
import { listProposals } from '../../../../server/domain/proposals';

/** Open change sets plus records nobody decided on in the approved graph. */
export async function reviewCount(db: Db, actor: ActorContext, projectId: string) {
  const [main, drafts] = await Promise.all([
    resolveView(db, actor, projectId, { kind: 'main' }),
    listProposals(db, actor, { projectId, status: 'draft', limit: 50 }),
  ]);
  return (await countPending(db, projectId, main.snapshot)) + drafts.items.length;
}
```

Check the `Db` import path with `grep -rn "export type Db" src/server` and fix it if it differs.

- [ ] **Step 10: Layouts.** Replace `src/app/(app)/layout.tsx` with:

```tsx
import { requireActor } from '../../server/http/rsc';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireActor('/');
  return children;
}
```

Create `src/app/(app)/projects/[id]/layout.tsx`:

```tsx
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import '../../../shell.css';
import { IdSchema } from '../../../../contracts';
import { Rail } from '../../../../components/shell/Rail';
import { parseRailState, RAIL_COOKIE } from '../../../../components/shell/rail-state';
import { getApp } from '../../../../server/app';
import { listProjects } from '../../../../server/domain/projects';
import { notFoundOn, requireActor } from '../../../../server/http/rsc';
import { reviewCount } from './review-count';

export const dynamic = 'force-dynamic';

export default async function ProjectLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ id: string }> }>) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) notFound();
  const actor = await requireActor(`/projects/${id}/graph`);
  const db = getApp().db;
  const [projects, store] = await Promise.all([listProjects(db, actor), cookies()]);
  if (!projects.some((project) => project.id === id)) notFound();
  const waiting = await notFoundOn(reviewCount(db, actor, id));
  return (
    <div className="app">
      <Rail
        projectId={id}
        projects={projects.map(({ id, clientName, title }) => ({ id, clientName, title }))}
        waiting={waiting}
        initial={parseRailState(store.get(RAIL_COOKIE)?.value)}
      />
      <div className="main">{children}</div>
    </div>
  );
}
```

The home page (`(app)/page.tsx`) "No projects yet" now renders without a rail; wrap its `<section>` in `<main className="main">`. Delete `src/components/shell/RailNav.tsx`.

- [ ] **Step 11: CSS** `src/app/shell.css`:

```css
.app {
  grid-template-columns: auto minmax(0, 1fr);
}
.rail {
  width: 212px;
  padding: 14px 10px;
  gap: 12px;
  overflow: hidden;
  transition: width 0.16s ease;
}
.rail[data-state='collapsed'] {
  width: 56px;
}
.rail[data-state='collapsed'] .rail-label {
  display: none;
}
.rail-ic {
  width: 16px;
  height: 16px;
  flex: none;
}
.rail-nav,
.rail-foot {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rail-foot {
  margin-top: auto;
}
.rail-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--ink-2);
  font: inherit;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.rail-item:hover {
  background: var(--rule-2);
  color: var(--ink);
}
.rail-item[aria-current='page'] {
  background: var(--rule-2);
  color: var(--ink);
  font-weight: 600;
}
.rail-count {
  margin-left: auto;
  border-radius: 999px;
  padding: 0 6px;
  background: var(--ink);
  color: var(--panel);
  font-size: 11px;
  font-weight: 600;
}
.rail[data-state='collapsed'] .rail-item[data-dot]::after {
  content: '';
  position: absolute;
  top: 6px;
  left: 24px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--draft);
  box-shadow: 0 0 0 2px var(--sunk);
}
.rail-note {
  margin: 0;
  padding: 4px 10px 8px;
  color: var(--ink-3);
  font-size: 11px;
  white-space: normal;
}
.proj-switch {
  position: relative;
}
.proj-switch summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px;
  border: 1px solid var(--rule);
  border-radius: 8px;
  background: var(--surface);
  list-style: none;
  cursor: pointer;
  white-space: nowrap;
}
.proj-switch summary::-webkit-details-marker {
  display: none;
}
.rail[data-state='collapsed'] .proj-switch summary {
  border-color: transparent;
  background: none;
  padding: 6px 4px;
}
.proj-avatar {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: 6px;
  background: var(--ink);
  color: var(--panel);
  font-size: 12px;
  font-weight: 700;
}
.proj-names b,
.proj-names small,
.proj-menu b,
.proj-menu small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.25;
}
.proj-names b {
  font-size: 13px;
}
.proj-names small,
.proj-menu small {
  color: var(--ink-3);
  font-size: 11px;
}
.proj-names {
  min-width: 0;
}
.proj-caret {
  margin-left: auto;
  color: var(--ink-3);
}
.proj-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  left: 0;
  width: 240px;
  margin: 0;
  padding: 4px;
  list-style: none;
  border: 1px solid var(--rule);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: var(--shadow);
}
.proj-menu a {
  display: block;
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--ink);
}
.proj-menu a:hover,
.proj-menu a[aria-current='true'] {
  background: var(--rule-2);
}
@media (max-width: 760px) {
  .rail,
  .rail[data-state='collapsed'] {
    width: auto;
  }
  .rail[data-state='collapsed'] .rail-label {
    display: inline;
  }
  .rail-nav {
    flex-direction: row;
    overflow-x: auto;
    flex: 1;
  }
  .rail-foot {
    flex-direction: row;
    margin-top: 0;
  }
  .rail-note,
  .rail-fold,
  .proj-names,
  .proj-caret {
    display: none;
  }
}
```

The existing `.app`, `.rail`, `.nav`, `.brand` rules in `globals.css` stay; the rules above load later and win by source order at equal specificity. If a rule does not win, raise the specificity with `.app > .rail`. Do not edit `globals.css`.

- [ ] **Step 12: E2E** `tests/e2e/shell.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

const PROJECT = 'Larkspur Capital';

test('the rail folds to icons, keeps the state after a reload, and opens again', async ({ page }) => {
  await page.goto('/signin?label=shell');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Project' });
  await expect(nav.getByRole('link', { name: 'Graph' })).toBeVisible();
  await expect(nav.getByRole('link', { name: /^Review/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Escalations' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Inbox' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Proposals' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.locator('.rail')).toHaveAttribute('data-state', 'collapsed');
  await expect(nav.getByText('Graph', { exact: true })).toBeHidden();
  await page.reload();
  await expect(page.locator('.rail')).toHaveAttribute('data-state', 'collapsed');
  await expect(nav.getByRole('link', { name: 'Graph' })).toBeVisible();

  await page.getByRole('link', { name: /^Review/ }).click();
  await expect(page).toHaveURL(/\/review/);
  await expect(page.locator('.rail')).toHaveAttribute('data-state', 'collapsed');

  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.locator('.rail')).toHaveAttribute('data-state', 'open');
  await expect(nav.getByText('Graph', { exact: true })).toBeVisible();
});
```

(The `/review` route lands in Task 6. Until then this step's Review navigation 404s; run the spec after Task 6, or temporarily stop at the reload assertion.)

- [ ] **Step 13: Gates.** typecheck, lint, `npx pnpm@11.25.0 test tests/unit/shell` → PASS. Start `npx pnpm@11.25.0 dev` and check the rail by hand in light and dark at 1280 px and 390 px.

- [ ] **Step 14: Commit.**

```bash
git add -A src/app src/components/shell tests/unit/shell tests/e2e/shell.spec.ts
git commit -m "feat: one-project rail with Graph, Review and Escalations that folds to icons"
```

---

### Task 3: Problems-only filter, simpler filter bar and header

**Files:**
- Modify: `src/components/graph/filters.ts`, `src/components/graph/FilterBar.tsx`, `src/components/graph/GraphHeader.tsx`, `tests/unit/graph/filters.test.ts`
- Create: CSS for the popover inside `src/app/shell.css` (append).

**Interfaces:**
- Produces: `GraphFilters.problems: boolean`; URL key `problems=1`. `applyFilters` keeps only loops with `derived.breakdowns.length > 0` when `problems` is true. `GraphScreen` passes `onChange` through `update`, so no `GraphScreen` change is needed. GraphHeader keeps its props, so `graph/page.tsx` does not change.

- [ ] **Step 1: Failing tests.** Append to `tests/unit/graph/filters.test.ts` inside `describe('graph filters', …)`:

```ts
  it('problems=1 keeps only loops with a breakdown and round-trips through the URL', () => {
    const filters = parseFilters(new URLSearchParams('problems=1'));
    expect(filters.problems).toBe(true);
    expect(filtersToSearch(filters).get('problems')).toBe('1');
    expect(parseFilters(new URLSearchParams('problems=yes')).problems).toBe(false);
    expect(filtersToSearch(parseFilters(new URLSearchParams(''))).has('problems')).toBe(false);
    const withProblems = engine.loops
      .filter((item) => item.breakdowns.length > 0)
      .map((item) => item.loop.title)
      .sort();
    expect(withProblems.length).toBeGreaterThan(0);
    expect(titles(visible('problems=1'))).toEqual(withProblems);
  });

  it('problems=1 combines with a department filter', () => {
    const query = `problems=1&dept=${dept('Engineering')}`;
    for (const title of titles(visible(query))) {
      const derived = engine.loops.find((item) => item.loop.title === title)!;
      expect(derived.breakdowns.length).toBeGreaterThan(0);
      expect(derived.loop.performerDepartmentId).toBe(dept('Engineering'));
    }
  });
```

- [ ] **Step 2: Run.** `npx pnpm@11.25.0 test tests/unit/graph/filters.test.ts` → FAIL (`problems` undefined).

- [ ] **Step 3: Implement in `filters.ts`.**
  - Add `problems: boolean;` to `GraphFilters` after `breakdown`.
  - In `parseFilters`: `problems: search.get('problems') === '1',`.
  - In `filtersToSearch`: add `'problems'` to the delete list and `if (filters.problems) search.set('problems', '1');` after the breakdown line.
  - In `applyFilters`, after the breakdown check: `if (filters.problems && derived.breakdowns.length === 0) continue;`.
  - Fix every `GraphFilters` object literal that typecheck reports (search `grep -rn "parseFilters\|GraphFilters = {" src tests`). Files owned by the other session must not need a change; if typecheck reports one, stop and message session `tropicbird-a8`.

- [ ] **Step 4: Run.** Same command → PASS.

- [ ] **Step 5: FilterBar.** Replace the JSX of `FilterBar` (keep `Segmented`, props and `toggle`) with: a search input; a `Problems only` toggle button (`aria-pressed={filters.problems}`, `onClick={() => onChange({ problems: !filters.problems })}`); a `<details className="filter-pop">` whose `<summary>` reads `Filter` plus `({n})` when `n > 0`, where `n` counts `side`, a non-empty `departmentIds`, `state`, `breakdown`, `milestoneId`; inside it the existing Side segmented control, department chips, State select, Breakdown select relabelled **Problem type**, Milestone select, and a `Clear` button that calls `onChange({ side: null, departmentIds: [], state: null, breakdown: null, milestoneId: null, problems: false })`; then the Graph/List segmented control. Keep every existing `aria-label` and `id` so other tests still find them.

Append to `src/app/shell.css`:

```css
.filter-pop {
  position: relative;
}
.filter-pop > summary {
  list-style: none;
  cursor: pointer;
}
.filter-pop > summary::-webkit-details-marker {
  display: none;
}
.filter-pop[open] > .filter-body {
  position: absolute;
  z-index: 25;
  top: calc(100% + 6px);
  left: 0;
  display: grid;
  gap: 10px;
  width: min(340px, 90vw);
  padding: 12px;
  border: 1px solid var(--rule);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: var(--shadow);
}
```

- [ ] **Step 6: GraphHeader.** Keep `Props` unchanged. Render:
  - top bar: `<b>{title}</b>` and `<small>Time zone {timeZone}</small>`; on the right, when `pendingEvidenceCount > 0`, `<Link className="pill" href={`/projects/${projectId}/review?tab=records`}>{n} new {record|records} to review</Link>`.
  - status line: badge `Approved graph` (`data-testid="main-badge"` stays), then `Last change {head.at}{head.by ? ` by ${head.by}` : ''} · <Link href={`/projects/${projectId}/history`}>Activity</Link>` (keep `data-testid="head-commit"` on a visually hidden `<span className="sr">` holding `head.id`, so existing graph e2e that reads it keeps working), spacer, the date form with label **As of** (`aria-label="Evaluation time T"` stays), Reset button.
  - Remove the keyboard hint, the evidence revision, the `LockIcon` and the "Create proposal" link. `evidenceRevision` stays in Props and is unused; prefix it with `_` in the destructuring to satisfy lint, or keep it and add `void evidenceRevision;` (choose what the lint config accepts).

- [ ] **Step 7: Gates.** typecheck, lint, `npx pnpm@11.25.0 test tests/unit/graph` → PASS. Run `graph.spec.ts` once: `TEST_DATABASE_URL=… npx pnpm@11.25.0 test:e2e tests/e2e/graph.spec.ts > /tmp/e2e-graph.log 2>&1; echo $?`. If a test fails only because of a header or filter label, list the failing selectors and send them to session `tropicbird-a8` (it owns `graph.spec.ts`); do not edit that file.

- [ ] **Step 8: Commit.**

```bash
git add src/components/graph/filters.ts src/components/graph/FilterBar.tsx src/components/graph/GraphHeader.tsx src/app/shell.css tests/unit/graph/filters.test.ts
git commit -m "feat: graph header in plain words, and filters behind search, Problems only and Filter"
```

---

### Task 4: Review queue rules

**Files:**
- Create: `src/components/review-queue/state.ts`, `tests/unit/review-queue/state.test.ts`

**Interfaces:**
- Produces:
  - `type ChangeSetState = 'ready' | 'needs-refresh' | 'needs-update' | 'conflict'`
  - `changeSetState(set: { baseCommitId: string; evidenceRevision: number }, current: { mainCommitId: string; evidenceRevision: number }, conflictCount: number | null): ChangeSetState`
  - `STATE_BADGE: Record<ChangeSetState, { label: string; tone: 'ok' | 'warn' | 'bad' }>`
  - `MY_REVIEW_TITLE = 'My review'`
  - `pickMyReview<T extends { title: string; status: string; updatedAt: string; author: ActorReference }>(drafts: readonly T[], userId: string): T | null`
  - `type ReviewQuery = { tab: 'sets' | 'records'; item: string | null; r: string | null }`
  - `parseReviewQuery(raw: Record<string, string | string[] | undefined>, hasSets: boolean): ReviewQuery`
  - `reviewHref(projectId: string, query: Partial<ReviewQuery> & { tab: ReviewQuery['tab'] }): string`

- [ ] **Step 1: Failing tests** `tests/unit/review-queue/state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  changeSetState,
  MY_REVIEW_TITLE,
  parseReviewQuery,
  pickMyReview,
  reviewHref,
} from '../../../src/components/review-queue/state';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const P = '00000000-0000-4000-8000-0000000000aa';
const current = { mainCommitId: A, evidenceRevision: 7 };

describe('change set state', () => {
  it('is ready on the current version and evidence', () => {
    expect(changeSetState({ baseCommitId: A, evidenceRevision: 7 }, current, 0)).toBe('ready');
  });
  it('needs a refresh when only the evidence moved', () => {
    expect(changeSetState({ baseCommitId: A, evidenceRevision: 6 }, current, null)).toBe('needs-refresh');
  });
  it('needs an update when the graph moved with no conflict', () => {
    expect(changeSetState({ baseCommitId: B, evidenceRevision: 7 }, current, 0)).toBe('needs-update');
    expect(changeSetState({ baseCommitId: B, evidenceRevision: 7 }, current, null)).toBe('needs-update');
  });
  it('is a conflict when the graph moved and an entity changed on both sides', () => {
    expect(changeSetState({ baseCommitId: B, evidenceRevision: 7 }, current, 2)).toBe('conflict');
  });
  it('stale base wins over moved evidence', () => {
    expect(changeSetState({ baseCommitId: B, evidenceRevision: 6 }, current, 0)).toBe('needs-update');
  });
});

describe('my review', () => {
  const draft = (over: Partial<{ title: string; status: string; updatedAt: string; userId: string }>) => ({
    title: over.title ?? MY_REVIEW_TITLE,
    status: over.status ?? 'draft',
    updatedAt: over.updatedAt ?? '2026-10-09T10:00:00.000Z',
    author: { kind: 'user' as const, userId: over.userId ?? 'u1' },
  });
  it('picks the newest open "My review" of this user only', () => {
    const older = draft({ updatedAt: '2026-10-08T10:00:00.000Z' });
    const newer = draft({ updatedAt: '2026-10-09T10:00:00.000Z' });
    const other = draft({ userId: 'u2', updatedAt: '2026-10-10T10:00:00.000Z' });
    const renamed = draft({ title: 'Inbox review', updatedAt: '2026-10-11T10:00:00.000Z' });
    const merged = draft({ status: 'merged', updatedAt: '2026-10-12T10:00:00.000Z' });
    expect(pickMyReview([older, other, newer, renamed, merged], 'u1')).toBe(newer);
    expect(pickMyReview([other], 'u1')).toBeNull();
  });
  it('ignores agent drafts', () => {
    const agent = { ...draft({}), author: { kind: 'agent' as const, tokenId: 't1' } };
    expect(pickMyReview([agent as never], 'u1')).toBeNull();
  });
});

describe('review URLs', () => {
  it('defaults to change sets when one exists, else to records', () => {
    expect(parseReviewQuery({}, true)).toEqual({ tab: 'sets', item: null, r: null });
    expect(parseReviewQuery({}, false)).toEqual({ tab: 'records', item: null, r: null });
  });
  it('keeps a valid tab and ids and drops invalid ones', () => {
    expect(parseReviewQuery({ tab: 'records', r: P }, true)).toEqual({ tab: 'records', item: null, r: P });
    expect(parseReviewQuery({ tab: 'sets', item: 'nope' }, true)).toEqual({ tab: 'sets', item: null, r: null });
    expect(parseReviewQuery({ tab: ['sets', 'records'] }, false)).toEqual({ tab: 'records', item: null, r: null });
  });
  it('builds links', () => {
    expect(reviewHref(A, { tab: 'sets' })).toBe(`/projects/${A}/review?tab=sets`);
    expect(reviewHref(A, { tab: 'sets', item: P })).toBe(`/projects/${A}/review?tab=sets&item=${P}`);
    expect(reviewHref(A, { tab: 'records', r: P })).toBe(`/projects/${A}/review?tab=records&r=${P}`);
  });
});
```

- [ ] **Step 2: Run.** `npx pnpm@11.25.0 test tests/unit/review-queue` → FAIL, module not found.

- [ ] **Step 3: Implement** `src/components/review-queue/state.ts`:

```ts
import type { ActorReference } from '../../contracts';
import { IdSchema } from '../../contracts/primitives';

export type ChangeSetState = 'ready' | 'needs-refresh' | 'needs-update' | 'conflict';

/** A stale base comes first: the rebase also pins the current evidence, so a refresh alone would not unblock the approve. */
export function changeSetState(
  set: { baseCommitId: string; evidenceRevision: number },
  current: { mainCommitId: string; evidenceRevision: number },
  conflictCount: number | null,
): ChangeSetState {
  if (set.baseCommitId !== current.mainCommitId)
    return conflictCount ? 'conflict' : 'needs-update';
  return set.evidenceRevision === current.evidenceRevision ? 'ready' : 'needs-refresh';
}

export const STATE_BADGE: Record<ChangeSetState, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  ready: { label: 'Ready', tone: 'ok' },
  'needs-refresh': { label: 'Needs refresh', tone: 'warn' },
  'needs-update': { label: 'Needs update', tone: 'warn' },
  conflict: { label: 'Conflict', tone: 'bad' },
};

export const MY_REVIEW_TITLE = 'My review';

export function pickMyReview<
  T extends { title: string; status: string; updatedAt: string; author: ActorReference },
>(drafts: readonly T[], userId: string): T | null {
  const mine = drafts.filter(
    (draft) =>
      draft.status === 'draft' &&
      draft.title === MY_REVIEW_TITLE &&
      draft.author.kind === 'user' &&
      draft.author.userId === userId,
  );
  mine.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return mine[0] ?? null;
}

export type ReviewQuery = { tab: 'sets' | 'records'; item: string | null; r: string | null };

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : null);
const id = (value: string | null) => (value !== null && IdSchema.safeParse(value).success ? value : null);

export function parseReviewQuery(
  raw: Record<string, string | string[] | undefined>,
  hasSets: boolean,
): ReviewQuery {
  const tab = one(raw.tab);
  return {
    tab: tab === 'sets' || tab === 'records' ? tab : hasSets ? 'sets' : 'records',
    item: id(one(raw.item)),
    r: id(one(raw.r)),
  };
}

export function reviewHref(
  projectId: string,
  query: Partial<ReviewQuery> & { tab: ReviewQuery['tab'] },
): string {
  const search = new URLSearchParams({ tab: query.tab });
  if (query.item) search.set('item', query.item);
  if (query.r) search.set('r', query.r);
  return `/projects/${projectId}/review?${search.toString()}`;
}
```

Check that `ActorReference` for a user has `userId` (`grep -n "ActorReferenceSchema" -A8 src/contracts/*.ts`); adjust the field name if it differs, in code and test.

- [ ] **Step 4: Run.** Same command → PASS (10 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/components/review-queue/state.ts tests/unit/review-queue/state.test.ts
git commit -m "feat: review queue rules for change set state, My review and links"
```

---

### Task 5: "My review" as the one target for record decisions

**Files:**
- Modify: `src/components/inbox/RecordViewer.tsx` (draft title), `src/components/inbox/DecisionButtons.tsx` (draft title)
- Create: `src/components/review-queue/IgnoreRecord.tsx`

**Interfaces:**
- Consumes: `MY_REVIEW_TITLE`, `reviewHref` (Task 4); `createDraft`, `updateDraft`, `Basis`, `ApiError` from `src/components/inbox/api.ts`; `ConflictBanner` from `src/components/review/ConflictBanner.tsx`.
- Produces: `<IgnoreRecord projectId recordVersionId target basis citedByVisibleAct />` where `target: { id: string; revision: number } | null`.

- [ ] **Step 1:** In `RecordViewer.tsx` and `DecisionButtons.tsx`, replace the literal `'Inbox review'` with `MY_REVIEW_TITLE` (import from `../review-queue/state`).

- [ ] **Step 2: Create** `src/components/review-queue/IgnoreRecord.tsx`:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createDraft, updateDraft, type ApiError, type Basis } from '../inbox/api';
import { ConflictBanner } from '../review/ConflictBanner';
import { MY_REVIEW_TITLE, reviewHref } from './state';

type Props = {
  projectId: string;
  recordVersionId: string;
  target: { id: string; revision: number } | null;
  basis: Basis;
  citedByVisibleAct: boolean;
};

export function IgnoreRecord({ projectId, recordVersionId, target, basis, citedByVisibleAct }: Props) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);

  const ignore = async () => {
    setBusy(true);
    setFailure(null);
    let draft = target;
    if (!draft) {
      const created = await createDraft(projectId, basis, MY_REVIEW_TITLE);
      if (!created.ok) {
        setFailure(created.error);
        setBusy(false);
        return;
      }
      draft = { id: created.data.id, revision: created.data.revision };
    }
    const result = await updateDraft(projectId, draft, basis.evidenceRevision, [
      {
        op: 'put',
        collection: 'recordDecisions',
        value: { recordVersionId, disposition: 'ignored', reason: reason.trim() },
      },
    ]);
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    router.push(reviewHref(projectId, { tab: 'records' }));
    router.refresh();
  };

  return (
    <div className="stack">
      {failure && (
        <ConflictBanner
          title={failure.status === 409 ? 'Conflict: something changed since this page loaded.' : 'The record was not ignored.'}
          message="Your reason is kept. Reload, then ignore it again."
          error={failure}
          actions={
            <button className="btn" type="button" onClick={() => router.refresh()}>
              Reload
            </button>
          }
        />
      )}
      <div className="row">
        <input
          className="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={2000}
          placeholder="Reason to ignore, for example: auto-reply"
          aria-label="Reason to ignore"
        />
        <button
          className="btn"
          type="button"
          disabled={busy || !reason.trim() || citedByVisibleAct}
          onClick={ignore}
        >
          Ignore
        </button>
      </div>
      <p className="faint" style={{ fontSize: 12 }}>
        {citedByVisibleAct
          ? 'Acts cite this record. Hide or remove them in the change set before you ignore it.'
          : `Your decisions go into your change set "${MY_REVIEW_TITLE}". The graph changes when you approve it.`}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Gates.** typecheck and lint → `0`.

- [ ] **Step 4: Commit.**

```bash
git add src/components/inbox/RecordViewer.tsx src/components/inbox/DecisionButtons.tsx src/components/review-queue/IgnoreRecord.tsx
git commit -m "feat: record decisions go into one change set called My review"
```

---

### Task 6: Review screen

**Files:**
- Create: `src/app/(app)/projects/[id]/review/page.tsx`, `src/app/(app)/projects/[id]/review/change-set-detail.tsx`, `src/app/(app)/projects/[id]/review/record-detail.tsx`, `src/components/review-queue/QueueList.tsx`, `src/components/review-queue/ChangeSetActions.tsx`, `src/components/review/CitedSources.tsx`, `src/app/review.css`
- Modify: `src/app/(app)/projects/[id]/proposals/[proposalId]/review/page.tsx` (becomes a redirect), `src/app/(app)/projects/[id]/proposals/page.tsx` (redirect)
- Delete: `src/components/review/MergePanel.tsx`

**Interfaces:**
- Consumes: Task 4 (`changeSetState`, `STATE_BADGE`, `parseReviewQuery`, `reviewHref`, `pickMyReview`), Task 5 (`IgnoreRecord`), domain reads `getProposal`, `listProposals`, `diffProposal` (`src/server/domain/proposals`), `resolveView`, `evaluationTime` (`src/server/domain/graph`, `src/server/domain/graph/hydrate`), `readInboxView` (`src/server/domain/inbox`), `readCitedRecords` (`src/server/domain/records`), `loadViewedRecord` (`../records/viewed-record`), components `DiffView`, `EffectsTable`, `AuthorBadge`, `InboxList`, `RecordViewer`, `ConflictBanner`, `CreateProposalForm`, helpers `capRecordIds`, `namesFrom`, `describeEntity` (`src/components/review/describe`), `quoteContext` (find with `grep -rn "export function quoteContext" src`), `shortStamp` (`src/components/graph/labels`).
- Produces: route `/projects/[id]/review` with query `tab`, `item`, `r`, `approved`, `updated`.

- [ ] **Step 1: Extract `CitedSources`.** Move the "Cited sources" `<section>` body from the old review page (`proposals/[proposalId]/review/page.tsx`, the block that maps `changedActs.slice(0, MAX_SOURCES)`) into `src/components/review/CitedSources.tsx` as a server-safe component:

```tsx
import type { Act } from '../../contracts';
import { shortStamp } from '../graph/labels';
import { describeEntity, type Names } from './describe';
// quoteContext: import from the module that the old review page imports it from.

export type CitedRecord = {
  bodyText: string | null;
  title: string;
  author: string;
  sourceLabel: string;
  occurredAt: string;
};
const MAX_SOURCES = 20;

export function CitedSources({
  acts,
  cited,
  names,
  timeZone,
}: {
  acts: readonly Act[];
  cited: ReadonlyMap<string, CitedRecord>;
  names: Names;
  timeZone: string;
}) {
  // body: the old JSX unchanged, with "offsets {start}–{end}, quote verified on save" removed
  // from the caption (the offsets move to Technical details in Step 4).
}
```

Copy the JSX exactly from the old page; only the caption changes as stated. Check the real type names (`Names`, the `cited` map value type returned by `readCitedRecords`) and use them instead of `CitedRecord` if they exist.

- [ ] **Step 2: `ChangeSetActions`** `src/components/review-queue/ChangeSetActions.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CommitReceipt, Proposal, RebasePreview } from '../../contracts';
import { send, updateDraft, type ApiError } from '../inbox/api';
import { ConflictBanner } from '../review/ConflictBanner';
import { useHydrated } from '../review/hydrated';
import { reviewHref, type ChangeSetState } from './state';

type Review = {
  mainCommitId: string;
  proposalRevision: number;
  evidenceRevision: number;
  digest: string;
  T: string;
};
type Props = {
  projectId: string;
  proposal: { id: string; revision: number; title: string };
  state: ChangeSetState;
  review: Review | null;
  current: { mainCommitId: string; evidenceRevision: number };
  T: string;
  graphHref: string;
  editHref: string;
};

export function ChangeSetActions({ projectId, proposal, state, review, current, T, graphHref, editHref }: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const base = `/api/v1/projects/${projectId}/proposals/${proposal.id}`;
  const here = reviewHref(projectId, { tab: 'sets', item: proposal.id });
  const run = async (work: () => Promise<{ ok: true } | { ok: false; error: ApiError }>) => {
    setBusy(true);
    setFailure(null);
    const result = await work();
    setBusy(false);
    if (!result.ok) setFailure(result.error);
  };

  const approve = () =>
    run(async () => {
      if (!review) return { ok: true };
      const result = await send<CommitReceipt>(`${base}/merge`, 'POST', {
        expectedMainCommitId: review.mainCommitId,
        expectedProposalRevision: review.proposalRevision,
        expectedEvidenceRevision: review.evidenceRevision,
        reviewDigest: review.digest,
        T: review.T,
        message: proposal.title,
        idempotencyKey: crypto.randomUUID(),
      });
      if (result.ok) {
        router.push(`${reviewHref(projectId, { tab: 'sets' })}&approved=${proposal.id}`);
        router.refresh();
      }
      return result;
    });

  const reject = () =>
    run(async () => {
      const result = await send<Proposal>(`${base}/close`, 'POST', {
        expectedProposalRevision: proposal.revision,
        idempotencyKey: crypto.randomUUID(),
      });
      if (result.ok) {
        router.push(reviewHref(projectId, { tab: 'sets' }));
        router.refresh();
      }
      return result;
    });

  const update = () =>
    run(async () => {
      const preview = await send<RebasePreview>(`${base}/rebase-preview`, 'POST', {
        expectedMainCommitId: current.mainCommitId,
        expectedProposalRevision: proposal.revision,
        expectedEvidenceRevision: current.evidenceRevision,
        T,
      });
      if (!preview.ok) return preview;
      if (preview.data.conflicts.length > 0) {
        router.push(`/projects/${projectId}/proposals/${proposal.id}/rebase`);
        return { ok: true };
      }
      const applied = await send<Proposal>(`${base}/rebase`, 'POST', {
        expectedMainCommitId: preview.data.mainCommitId,
        expectedProposalRevision: preview.data.proposalRevision,
        expectedEvidenceRevision: preview.data.evidenceRevision,
        reviewDigest: preview.data.digest,
        T: preview.data.T,
        resolutions: [],
        idempotencyKey: crypto.randomUUID(),
      });
      if (applied.ok) {
        router.push(`${here}&updated=1`);
        router.refresh();
      }
      return applied;
    });

  const refresh = () =>
    run(async () => {
      const result = await updateDraft(projectId, proposal, current.evidenceRevision, []);
      if (result.ok) router.refresh();
      return result;
    });

  const banner =
    state === 'needs-update' ? (
      <div className="banner warn" role="status">
        <span>The graph changed after this change set was made. Nothing conflicts.</span>
        <button className="btn btn-ink" type="button" disabled={!hydrated || busy} onClick={update}>
          Update to latest
        </button>
      </div>
    ) : state === 'conflict' ? (
      <div className="banner bad" role="status">
        <span>Another approved change touched the same items. Choose which side stays.</span>
        <Link className="btn btn-ink" href={`/projects/${projectId}/proposals/${proposal.id}/rebase`}>
          Resolve conflict
        </Link>
      </div>
    ) : state === 'needs-refresh' ? (
      <div className="banner warn" role="status">
        <span>New records arrived after this change set was made. Refresh to review it again.</span>
        <button className="btn btn-ink" type="button" disabled={!hydrated || busy} onClick={refresh}>
          Refresh
        </button>
      </div>
    ) : null;

  return (
    <div className="stack">
      <div className="actions" role="group" aria-label="Change set actions">
        <Link className="btn" href={graphHref}>View on graph</Link>
        <Link className="btn" href={editHref}>Edit</Link>
        <button className="btn btn-danger" type="button" disabled={!hydrated || busy} onClick={reject}>
          Reject
        </button>
        <button
          className="btn btn-ink"
          type="button"
          disabled={!hydrated || busy || state !== 'ready' || review === null}
          onClick={approve}
        >
          Approve
        </button>
      </div>
      {banner}
      {failure && (
        <ConflictBanner
          title={
            failure.status === 409
              ? 'Conflict: the graph or this change set changed since this page loaded.'
              : 'That did not work.'
          }
          message="Nothing changed. Reload to see the current state."
          error={failure}
          actions={
            <button className="btn" type="button" onClick={() => { setFailure(null); router.refresh(); }}>
              Reload
            </button>
          }
        />
      )}
    </div>
  );
}
```

Check that `RebasePreview`, `CommitReceipt` and `Proposal` are exported from `src/contracts` (index); import from `src/contracts/proposals` if not. Check `useHydrated` path (`src/components/review/hydrated.ts`).

- [ ] **Step 3: `QueueList`** `src/components/review-queue/QueueList.tsx` (server-safe, no hooks):

```tsx
import Link from 'next/link';
import type { ActorReference } from '../../contracts';
import { reviewHref, STATE_BADGE, type ChangeSetState, type ReviewQuery } from './state';

export type SetRow = {
  id: string;
  title: string;
  author: ActorReference;
  authorName: string;
  when: string;
  state: ChangeSetState;
};

export function QueueList({
  projectId,
  query,
  sets,
  recordCount,
  records,
}: {
  projectId: string;
  query: ReviewQuery;
  sets: SetRow[];
  recordCount: number;
  records: React.ReactNode;
}) {
  return (
    <div className="queue-list">
      <nav className="tabs" role="tablist" aria-label="Review">
        <Link role="tab" aria-selected={query.tab === 'sets'} href={reviewHref(projectId, { tab: 'sets' })}>
          Change sets <span className="c">{sets.length}</span>
        </Link>
        <Link role="tab" aria-selected={query.tab === 'records'} href={reviewHref(projectId, { tab: 'records' })}>
          New records <span className="c">{recordCount}</span>
        </Link>
      </nav>
      {query.tab === 'sets' ? (
        <ul className="queue-items" aria-label="Change sets">
          {sets.map((set) => (
            <li key={set.id}>
              <Link
                href={reviewHref(projectId, { tab: 'sets', item: set.id })}
                aria-current={query.item === set.id ? 'true' : undefined}
              >
                <b>{set.title}</b>
                <small>
                  {set.author.kind === 'agent' ? <span className="badge b-agent">Agent</span> : set.authorName}{' '}
                  · {set.when}{' '}
                  <span className={`badge q-${STATE_BADGE[set.state].tone}`}>{STATE_BADGE[set.state].label}</span>
                </small>
              </Link>
            </li>
          ))}
          {sets.length === 0 && <li className="faint">No open change sets.</li>}
        </ul>
      ) : (
        records
      )}
      <p className="faint queue-foot">
        Approved change sets are in <Link className="lnk" href={`/projects/${projectId}/history`}>Activity</Link>.
        {query.tab === 'records' && (
          <> <Link className="lnk" href={`/projects/${projectId}/inbox`}>All records</Link></>
        )}
      </p>
    </div>
  );
}
```

`authorName`: for a user author use `'you'` when `author.userId === actor.userId`, else `'A workspace member'` (same rule as the inbox `AuthorBadge`). The page computes it.

- [ ] **Step 4: `change-set-detail.tsx`** (async server component). Inputs: `{ projectId, proposalId, actor, current: { mainCommitId, evidenceRevision, snapshot }, timeZone }`. Steps inside:
  1. `const proposal = await notFoundOn(getProposal(db, actor, { projectId, proposalId }))`.
  2. If `proposal.status !== 'draft'`: render `<p>This change set is no longer open. <Link href={`/projects/${projectId}/history`}>See Activity</Link></p>` and return.
  3. `let review: ProposalReview | null = null; try { review = await diffProposal(db, actor, { projectId, proposalId }); } catch (error) { if (!(error instanceof AppError) || error.code !== 'CONFLICT') throw error; }` (same pattern as the old review page; import `AppError` from where that page imports it).
  4. `const state = changeSetState(proposal, current, review ? review.conflicts.length : null)`.
  5. Build `changedActs`, `wanted = capRecordIds(...)`, `cited = await readCitedRecords(...)`, `names = namesFrom(...)` exactly like the old review page (base snapshot = `current.snapshot` when `review.baseCommitId === current.mainCommitId`, else `resolveView(... { kind: 'commit', commitId: review.baseCommitId })`).
  6. Render:
     - `<h2>{proposal.title}</h2>`, `<AuthorBadge author={proposal.author} viewerUserId={actor.userId} prefix="By" />`, rationale in `<p className="faint">` when not empty.
     - `<ChangeSetActions projectId proposal={{ id, revision, title }} state review={review && { mainCommitId: review.mainCommitId, proposalRevision: review.proposalRevision, evidenceRevision: review.evidenceRevision, digest: review.digest, T: review.T }} current={{ mainCommitId, evidenceRevision }} T={evaluationTime(proposal.candidate)} graphHref={`/projects/${projectId}/graph?${new URLSearchParams({ proposal: proposal.id, rev: String(proposal.revision) })}`} editHref={`/projects/${projectId}/proposals/${proposal.id}`} />`
     - when `review`: `<section className="box"><h3>What changes</h3><DiffView changes={review.diff.changes} names={names} /></section>`, `<section className="box"><h3>Effect on the loops</h3><EffectsTable effects={review.effects} loopTitles={names.loops} T={shortStamp(review.T, timeZone)} /></section>`, `<section className="box"><h3>Quotes</h3><CitedSources acts={changedActs} cited={cited} names={names} timeZone={timeZone} /></section>`.
     - when `review.pendingEvidenceCount > 0`: `<p className="faint">{n} new {record is|records are} not reviewed yet. You can approve this change set before them.</p>`.
     - `<details><summary>Technical details</summary><dl className="kv">` with Based on version (`review.baseCommitId.slice(0, 7)`), Approved graph now (`review.mainCommitId.slice(0, 7)`), Change set revision, Evidence revision, Evaluated at, Snapshot hash, Review digest, and for each changed act "offsets start–end" `</dl></details>`.

- [ ] **Step 5: `record-detail.tsx`** (async server component). Inputs: `{ projectId, actor, inbox: InboxView, myReview: { id, revision } | null, timeZone }`. If `inbox.selected` is null, render `<p className="faint">No new records. Everything is decided.</p>`. Else `const viewed = await loadViewedRecord(actor, projectId, inbox.selected.recordVersionId, timeZone, (versionId) => reviewHref(projectId, { tab: 'records', r: versionId }))` and render `<RecordViewer key={viewed.record.id} projectId={projectId} record={viewed.record} state={inbox.selected.state} decision={inbox.selected.decision} hints={viewed.hints} proposalId={myReview?.id ?? null} basis={{ mainCommitId: inbox.mainCommitId, evidenceRevision: inbox.evidenceRevision }}><IgnoreRecord projectId={projectId} recordVersionId={viewed.record.id} target={myReview} basis={…same…} citedByVisibleAct={inbox.selected.citedByVisibleAct} /></RecordViewer>`.

- [ ] **Step 6: `review/page.tsx`**:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import '../../../../../review.css';
import { IdSchema } from '../../../../../../contracts';
import { shortStamp } from '../../../../../../components/graph/labels';
import { InboxList } from '../../../../../../components/inbox/InboxList';
import { CreateProposalForm } from '../../../../../../components/review/CreateProposalForm';
import { QueueList, type SetRow } from '../../../../../../components/review-queue/QueueList';
import {
  changeSetState,
  parseReviewQuery,
  pickMyReview,
} from '../../../../../../components/review-queue/state';
import { getApp } from '../../../../../../server/app';
import { resolveView } from '../../../../../../server/domain/graph';
import { readInboxView } from '../../../../../../server/domain/inbox';
import { getProposal, listProposals } from '../../../../../../server/domain/proposals';
import { notFoundOn, requireActor } from '../../../../../../server/http/rsc';
import { ChangeSetDetail } from './change-set-detail';
import { RecordDetail } from './record-detail';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Review · Promise Graph' };
type Search = Record<string, string | string[] | undefined>;

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const [{ id }, raw] = await Promise.all([params, searchParams]);
  if (!IdSchema.safeParse(id).success) notFound();
  const actor = await requireActor(`/projects/${id}/review`);
  const db = getApp().db;
  const [main, drafts] = await Promise.all([
    notFoundOn(resolveView(db, actor, id, { kind: 'main' })),
    notFoundOn(listProposals(db, actor, { projectId: id, status: 'draft', limit: 50 })),
  ]);
  const current = {
    mainCommitId: main.project.mainCommitId,
    evidenceRevision: main.project.evidenceRevision,
    snapshot: main.snapshot,
  };
  const timeZone = main.snapshot.context.timeZone;
  const query = parseReviewQuery(raw, drafts.items.length > 0);
  const myReview = pickMyReview(drafts.items, actor.userId);
  // Records already decided in "My review" leave the queue before that change set is approved.
  const inbox = await notFoundOn(
    readInboxView(db, actor, {
      projectId: id,
      view: myReview ? { kind: 'proposal', proposalId: myReview.id } : { kind: 'main' },
      state: 'pending',
      limit: 50,
      ...(query.r ? { recordVersionId: query.r } : { selectFirst: true }),
    }),
  );
  const sets: SetRow[] = [...drafts.items]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((draft) => ({
      id: draft.id,
      title: draft.title,
      author: draft.author,
      authorName:
        draft.author.kind === 'user' && draft.author.userId === actor.userId ? 'you' : 'A workspace member',
      when: shortStamp(draft.updatedAt, timeZone),
      state: changeSetState(draft, current, null),
    }));
  const item = query.tab === 'sets' ? (query.item ?? sets[0]?.id ?? null) : null;
  const approvedId = typeof raw.approved === 'string' && IdSchema.safeParse(raw.approved).success ? raw.approved : null;
  const approved = approvedId ? await getProposal(db, actor, { projectId: id, proposalId: approvedId }).catch(() => null) : null;

  return (
    <>
      <header className="topbar">
        <div className="proj">
          <b>Review</b>
          <small>{main.project.title}</small>
        </div>
        <span className="sp" />
        <details className="filter-pop">
          <summary className="btn">New change set</summary>
          <div className="filter-body">
            <CreateProposalForm projectId={id} basis={{ mainCommitId: current.mainCommitId, evidenceRevision: current.evidenceRevision }} />
          </div>
        </details>
      </header>
      {approved && (
        <p className="card pad notice-draft" role="status">
          Approved: {approved.title}.{' '}
          <Link className="lnk" href={`/projects/${id}/graph`}>View on graph</Link>
        </p>
      )}
      {raw.updated === '1' && (
        <p className="card pad notice-draft" role="status">
          Updated. Check the changes again, then approve.
        </p>
      )}
      <div className="queue">
        <QueueList
          projectId={id}
          query={query}
          sets={sets}
          recordCount={inbox.counts.pending}
          records={
            <InboxList
              projectId={id}
              items={inbox.page.items}
              query={{ state: 'pending', proposal: null }}
              selectedId={inbox.selected?.recordVersionId ?? null}
              timeZone={timeZone}
            />
          }
        />
        <div className="queue-detail">
          {query.tab === 'sets' ? (
            item ? (
              <ChangeSetDetail projectId={id} proposalId={item} actor={actor} current={current} timeZone={timeZone} />
            ) : (
              <p className="faint">No open change sets. Agents and people create them; you approve them here.</p>
            )
          ) : (
            <RecordDetail projectId={id} actor={actor} inbox={inbox} myReview={myReview} timeZone={timeZone} />
          )}
        </div>
      </div>
    </>
  );
}
```

Two adjustments to check while typing this:
  - `InboxList` builds its links with `inboxHref`; in Review the record links must go to `reviewHref(id, { tab: 'records', r })`. Add an optional prop `hrefFor?: (recordVersionId: string) => string` to `InboxList` (default: the current `inboxHref` behaviour) and pass `(r) => reviewHref(id, { tab: 'records', r })`. Functions cannot cross into a client component; if `InboxList` is a client component, pass a string template `basePath` instead (`reviewHref(id, { tab: 'records' })` and append `&r=`).
  - `project.title` may not be on `main.project`; use `listProjects` like other pages if it is missing.

- [ ] **Step 7: CSS** `src/app/review.css`:

```css
.queue {
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  min-height: calc(100vh - 60px);
}
.queue-list {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--rule);
  min-width: 0;
}
.queue-list .tabs {
  padding: 10px 12px 0;
}
.queue-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 6px;
  list-style: none;
}
.queue-items a {
  display: grid;
  gap: 3px;
  padding: 9px 10px;
  border-radius: 8px;
  color: var(--ink);
}
.queue-items a:hover,
.queue-items a[aria-current='true'] {
  background: var(--rule-2);
}
.queue-items small {
  color: var(--ink-3);
  font-size: 12px;
}
.queue-foot {
  margin: auto 0 0;
  padding: 10px 12px;
  border-top: 1px solid var(--rule);
  font-size: 12px;
}
.queue-detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 22px;
  min-width: 0;
}
.queue-detail .box {
  border: 1px solid var(--rule);
  border-radius: 10px;
  padding: 12px 14px;
}
.queue-detail .box h3 {
  margin: 0 0 8px;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.queue-detail .actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.banner.warn {
  background: var(--caution-bg);
}
.banner.bad {
  background: var(--danger-bg);
}
.badge.q-ok {
  background: var(--proceed-bg);
  color: var(--proceed);
}
.badge.q-warn {
  background: var(--caution-bg);
  color: var(--caution);
}
.badge.q-bad {
  background: var(--danger-bg);
  color: var(--danger);
}
.btn-danger {
  color: var(--danger);
}
@media (max-width: 760px) {
  .queue {
    grid-template-columns: minmax(0, 1fr);
  }
  .queue-list {
    border-right: 0;
    border-bottom: 1px solid var(--rule);
  }
}
```

- [ ] **Step 8: Redirects.** Replace the body of `proposals/page.tsx` with `redirect(reviewHref(id, { tab: 'sets' }))` after the id check. Replace the body of `proposals/[proposalId]/review/page.tsx` with `redirect(`${reviewHref(id, { tab: 'sets', item: proposalId })}${raw.rebased === '1' ? '&updated=1' : ''}`)` after the id checks. Delete `src/components/review/MergePanel.tsx` and remove its imports; move `AcknowledgeEvidence` nowhere (the Refresh button replaces it).

- [ ] **Step 9: Gates.** typecheck, lint, unit tests → `0`. `npx pnpm@11.25.0 dev`, sign in with the local button, open Review and check by hand: the seeded agent change set shows Ready; Approve lands on the list with "Approved: …"; the two competing title change sets (from `fixtures/proposals.json`) show Needs update after one is approved; New records lists 4 seeded records.

- [ ] **Step 10: Commit.**

```bash
git add -A src/app src/components tests
git commit -m "feat: Review screen with change sets and new records in one queue"
```

---

### Task 7: E2E for the Review queue

**Files:** Create `tests/e2e/review-queue.spec.ts`. Reuse the sign-in helper pattern from `tests/e2e/inbox.spec.ts` (sign in with `/signin?label=…`, read the project id from the URL).

- [ ] **Step 1: Write the spec** with these four tests (each signs in with its own label so each gets a fresh sandbox):

```ts
import { expect, test, type Page } from '@playwright/test';

const PROJECT = 'Larkspur Capital';
async function signIn(page: Page, label: string) {
  await page.goto(`/signin?label=${label}`);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  const match = page.url().match(/\/projects\/([0-9a-f-]{36})\//);
  expect(match).not.toBeNull();
  return match![1];
}
const sets = (page: Page) => page.getByRole('list', { name: 'Change sets' });
const actions = (page: Page) => page.getByRole('group', { name: 'Change set actions' });

test('approve the agent change set from Review and see the follow-up on the graph', async ({ page }) => {
  const projectId = await signIn(page, 'queue-approve');
  await page.goto(`/projects/${projectId}/review`);
  await sets(page).getByRole('link', { name: /Add Sarah's follow-up on the incident report/ }).click();
  await expect(page.getByRole('heading', { name: 'What changes' })).toBeVisible();
  await expect(page.getByText('Where is the root cause report you promised?')).toBeVisible();
  await actions(page).getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Approved: Add Sarah's follow-up/ })).toBeVisible();
  await expect(sets(page).getByRole('link', { name: /Add Sarah's follow-up/ })).toHaveCount(0);
});

test('after one title change set is approved the competing one needs an update and reaches Resolve conflict', async ({ page }) => {
  const projectId = await signIn(page, 'queue-compete');
  await page.goto(`/projects/${projectId}/review`);
  await sets(page).getByRole('link', { name: /as a phase 1 request/ }).click();
  await actions(page).getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Approved:/ })).toBeVisible();
  await sets(page).getByRole('link', { name: /with the SOW scope/ }).click();
  await expect(page.getByText(/Choose which side stays|Nothing conflicts/)).toBeVisible();
  const resolve = page.getByRole('link', { name: 'Resolve conflict' });
  if (await resolve.count()) {
    await resolve.click();
    await expect(page).toHaveURL(/\/rebase$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Resolve conflict' })).toBeVisible();
  } else {
    await page.getByRole('button', { name: 'Update to latest' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Updated. Check the changes again' })).toBeVisible();
  }
});

test('ignore the out-of-office reply: it leaves New records and sits in My review', async ({ page }) => {
  const projectId = await signIn(page, 'queue-ignore');
  await page.goto(`/projects/${projectId}/review?tab=records`);
  await page.getByRole('link', { name: /Automatic reply: out of office/ }).click();
  await page.getByLabel('Reason to ignore').fill('Auto-reply');
  await page.getByRole('button', { name: 'Ignore', exact: true }).click();
  await expect(page.getByRole('link', { name: /Automatic reply: out of office/ })).toHaveCount(0);
  await page.getByRole('tab', { name: /^Change sets/ }).click();
  await sets(page).getByRole('link', { name: /^My review/ }).click();
  await expect(page.getByText('Automatic reply: out of office')).toBeVisible();
});

test('a second approve of the same change set shows a conflict and stays on the screen', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const projectId = await signIn(page, 'queue-double');
  const url = `/projects/${projectId}/review`;
  await page.goto(url);
  await sets(page).getByRole('link', { name: /Add Sarah's follow-up/ }).click();
  const other = await context.newPage();
  await other.goto(page.url());
  await actions(page).getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Approved:/ })).toBeVisible();
  await actions(other).getByRole('button', { name: 'Approve' }).click();
  await expect(other.getByRole('alert').filter({ hasText: 'Conflict' })).toBeVisible();
  await expect(other).toHaveURL(/item=/);
  await context.close();
});
```

Check the exact author of "My review" titles and the conflict text against the code from Task 6. `ConflictBanner` renders `role="alert"`; confirm with `grep -n "role=" src/components/review/ConflictBanner.tsx`.

- [ ] **Step 2: Run.** `TEST_DATABASE_URL=… npx pnpm@11.25.0 test:e2e tests/e2e/review-queue.spec.ts tests/e2e/shell.spec.ts > /tmp/e2e-q.log 2>&1; echo $?` → `0`; read the summary (`4 passed` + `1 passed`).

- [ ] **Step 3: Commit.**

```bash
git add tests/e2e/review-queue.spec.ts
git commit -m "test: review queue approve, update, ignore and double approve"
```

---

### Task 8: Move the old merge flows in e2e to the Review screen

**Files:** `tests/e2e/review.spec.ts`, `tests/e2e/release.spec.ts`, `tests/e2e/inbox.spec.ts`.

- [ ] **Step 1:** In `release.spec.ts` replace the merge helper (lines ~110–125: `Merge into main`, `Acknowledge evidence revision`, the `still pending review` checkbox, `Commit message`) with: open `/projects/${projectId}/review?tab=sets&item=${proposalId}`; if a `Refresh` button shows, click it and wait for it to go away; click `Approve` in the `Change set actions` group; expect the `Approved:` status. Replace `'Main moved since this draft was based.'` with the `Update to latest` / `Resolve conflict` banners. Replace the expectation `toHaveURL(…/review\?rebased=1$)` with `toHaveURL(/\/review\?tab=sets&item=[0-9a-f-]{36}&updated=1$/)` and `'Fresh review required'` with `'Updated. Check the changes again, then approve.'`.
- [ ] **Step 2:** Apply the same changes to `review.spec.ts` (tests at lines 46 and 159). The navigation `page.goto(`/projects/${projectId}/proposals`)` + click by title becomes `page.goto(`/projects/${projectId}/review`)` + `sets(page).getByRole('link', { name: title })`.
- [ ] **Step 3:** In `inbox.spec.ts` the rail link `Inbox` no longer exists: replace the nav click with `page.goto(`/projects/${projectId}/inbox`)` and the expected heading text with `All records`.
- [ ] **Step 4: Full e2e.** `TEST_DATABASE_URL=… npx pnpm@11.25.0 test:e2e > /tmp/e2e.log 2>&1; echo $?` → `0`. If `graph.spec.ts` fails, see Task 3 Step 7 (report to `tropicbird-a8`, do not edit).
- [ ] **Step 5: Commit.**

```bash
git add tests/e2e
git commit -m "test: e2e merge flows run through the Review screen"
```

---

### Task 9: Canvas cuts (waits for coordination)

**Owner:** decided with session `tropicbird-a8` (message sent 15 October 2026). Do this task only after its answer.

- If that session does the cuts on `phucluu/graph-polish`: skip this task; rebase `phucluu/simplify-ui` onto `phucluu/graph-polish` before Task 10 and resolve conflicts (expected only in `tests/e2e/*` text).
- If this branch does them after a rebase onto `phucluu/graph-polish`:
  - [ ] Remove the minimap button and the % preset menu from `CanvasControls.tsx` (the % becomes plain text), remove `AxisMenu.tsx` and its render, remove the day resize handles and `day-width-store.ts` and their tests, keep the day labels.
  - [ ] Update `tests/e2e/graph.spec.ts`: delete the minimap test (line ~372), the zoom-preset menu steps (line ~28) and the axis menu test (line ~544).
  - [ ] Gates, then commit `feat: canvas keeps zoom, fit and full screen only`.

---

### Task 10: Docs and screenshots

**Files:** `README.md`, `docs/screenshots/*.png`, `docs/superpowers/specs/2026-10-14-ui-redesign-decisions.md`, `docs/mcp-agent-recipe.md` (only if it names UI screens).

- [ ] **Step 1:** README: "Connect an agent" step 1 → "Open **Settings** in a project and create a token." "How it works" keeps API words and adds one line: "The screens call a proposal a change set and a merge an approval."
- [ ] **Step 2:** Replace `docs/screenshots/graph-loop-panel.png`, `proposal-review.png` (rename to `review-queue.png`), `agent-tokens.png` with fresh screenshots from `npx pnpm@11.25.0 build && npx pnpm@11.25.0 start` on the seeded sandbox; update the README captions.
- [ ] **Step 3:** Add section "F. Simpler screens (15 October 2026)" to the decision record with a link to the spec.
- [ ] **Step 4: Full gates in a separate worktree** (typecheck, lint, format:check, unit + integration with `TEST_DATABASE_URL`, e2e, build, `check:providers`), each with `> log 2>&1; echo $?` and the summary line read.
- [ ] **Step 5: Commit** `docs: README, screenshots and decision record for the simpler screens`. Do not push. Start the app on `localhost:3000` and tell the owner what to check.
