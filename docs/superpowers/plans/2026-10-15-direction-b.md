# Direction B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Escalations, show agent notes with cited steps, and fix snags V1, V3, V10, V17, V20, V21 and V23.

**Architecture:** Deletion first (one task, all layers, one migration), then notes (contract rule, fixture step, UI), then small UI fixes per screen, then the token "last call" column (second migration). Notes reuse the snapshot's existing `annotations` collection, so agents and the merge path need no new API.

**Tech Stack:** Next.js 16.4 (webpack dev), React 19, Zod 4, Drizzle 0.45 on PostgreSQL, Vitest 4, Playwright, React Flow.

**Spec:** `docs/superpowers/specs/2026-10-15-direction-b-design.md`

## Global Constraints

- Worktree `…/scratchpad/dirb`, branch `phucluu/direction-b`, base `phucluu/zoom-out` (8d6187a). Never touch the owner's checkout or the `simplify` worktree (its dev server runs on port 3000).
- `pnpm` is not on PATH. Use `./node_modules/.bin/<tool>`.
- `TEST_DATABASE_URL=postgresql://promise_graph:local-development-only@127.0.0.1:55432/promise_graph` for integration and e2e. E2E uses `E2E_PORT=3300`, because the dev server of this worktree runs on 3100.
- Capture real exit codes: `cmd > /tmp/b-<name>.log 2>&1; echo $?`, then read the summary line.
- Commit after each task on the local branch. No push. No `Co-Authored-By` or other AI trailer.
- UI words: "note" (never "annotation"), "step" (never "act" on screen), "Requested by", "Done by", "Undo", "Go back". API, MCP and agent docs keep `annotations`, `act`, `customer`, `performer`.
- Comments: only the WHY, and only when the code cannot say it.

## Review Focus

1. A note with a malformed marker (`[act:ABC]`, `[act:` with no end) shows as plain text in the UI and never crashes the card. Test in Task 3.
2. A cite to a step that the As-of view does not hold (later than T, or hidden) is a grey, non-clickable number. Test in Task 3.
3. A stored token that held only `escalations:write` still authenticates and fails each tool with "Token scope required". Test in Task 1.
4. A loop-list click while a panel is already open switches the panel to the new loop and keeps the list hidden. Test in Task 4.
5. An agent call within one minute of the last one does not write the token row again. Test in Task 7.

---

### Task 1: Remove Escalations

**Files:**
- Delete: `src/app/(app)/projects/[id]/escalations/` (both pages), `src/app/api/v1/projects/[projectId]/escalations/` (4 routes), `src/server/domain/escalations/`, `src/contracts/escalations.ts`, `src/components/escalations/` except `markers.ts` (Task 2 moves it), `tests/e2e/escalations.spec.ts`, `tests/integration/escalations/`, `tests/unit/escalations/verdict.test.ts`
- Modify: `src/contracts/index.ts`, `src/contracts/identity.ts:10-22`, `src/contracts/mcp.ts:52`, `src/server/http/identity-store.ts:46-52`, `src/server/mcp/tools.ts` (imports and lines 301-321), `src/server/domain/graph/project.ts`, `src/server/domain/seed/index.ts` (imports, `ESCALATION_ANSWERS`, `seedEscalations`, its call, the doc comment), `src/server/db/schema.ts:271-318`, `src/components/settings/TokenCreate.tsx:19-22`, `src/components/shell/Rail.tsx:51`, `src/components/graph/GraphScreen.tsx`, `src/components/graph/filters.ts`, `src/app/(app)/projects/[id]/graph/page.tsx`, `src/app/(app)/projects/[id]/proposals/[proposalId]/page.tsx:196`, `scripts/build-fixtures.ts` (`ClaimSource`, `StorySource.escalations`, gold output at 700-712), `fixtures/story-source.json` (`escalations`), regenerated fixtures
- Create: `src/server/db/migrations/0002_remove_escalations.sql` (generated) and its meta files
- Test: `tests/integration/adapters/mcp.test.ts`, `tests/integration/adapters/rest.test.ts`, `tests/integration/security.test.ts`, `tests/integration/seed/seed.test.ts`, `tests/integration/graph/read.test.ts`, `tests/integration/db/identity-store.test.ts`, `tests/unit/contracts/domain-boundaries.test.ts`, `tests/unit/contracts/review-fixes.test.ts`, `tests/unit/fixtures/fixtures.test.ts`, `tests/unit/graph/filters.test.ts`, `tests/e2e/graph.spec.ts:267-280`, `tests/e2e/shell.spec.ts:14`, `tests/e2e/release.spec.ts:501`

**Interfaces:**
- Produces: `ScopeSchema = z.enum(['project:read','records:import','graph:propose','graph:merge'])`; `GetProjectResult` without `analysisFreshness`; `GraphScreenProps` without `escalation`; `GraphFilters` without `escalationId`. `citedLoops(engine, actIds)` stays in `filters.ts` (Task 3 uses it).

- [ ] **Step 1: Write the failing tests**

In `tests/integration/adapters/mcp.test.ts`, replace the escalation names in the expected tool list (lines ~432-451) so the list has no escalation tool, and delete the `open_escalation` call case (~479). Add:

```ts
it('lists no escalation tool', async () => {
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  expect(names.filter((name) => name.includes('escalation'))).toEqual([]);
});
```

In `tests/integration/db/identity-store.test.ts` add:

```ts
it('migration 0002 removes escalations:write from stored tokens', async () => {
  const pool = new Pool({ connectionString: t.url });
  await pool.query('DROP TABLE IF EXISTS migration_probe');
  // A token row written before 0002 may still hold the old scope; the migration's UPDATE is idempotent.
  await pool.query(
    `UPDATE agent_tokens SET scopes = array_append(scopes, 'escalations:write') WHERE id = $1`,
    [tokenId],
  );
  await pool.query(`UPDATE agent_tokens SET scopes = array_remove(scopes, 'escalations:write')`);
  const { rows } = await pool.query('SELECT scopes FROM agent_tokens WHERE id = $1', [tokenId]);
  expect(rows[0].scopes).not.toContain('escalations:write');
  const tables = await pool.query(
    `SELECT tablename FROM pg_tables WHERE tablename LIKE 'escalation%'`,
  );
  expect(tables.rows).toEqual([]);
  await pool.end();
});
```

Use the test's existing token setup to get `tokenId` (create one with `store.insertToken` as the other cases in this file do). In `tests/integration/adapters/mcp.test.ts` add the Review Focus 3 case:

```ts
it('a token with no scope left authenticates and every tool refuses it', async () => {
  const empty = await tokenWithScopes([]); // reuse the file's token factory with an empty scope list
  const result = await callAs(empty, 'get_project', { projectId });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result.content)).toContain('Token scope required');
});
```

If the file has no `tokenWithScopes` or `callAs` helper, write the token row with `store.insertToken({ …, scopes: [] })` and call through the same transport the other cases use.

- [ ] **Step 2: Run them and confirm they fail**

Run: `TEST_DATABASE_URL=… ./node_modules/.bin/vitest run tests/integration/adapters/mcp.test.ts tests/integration/db/identity-store.test.ts > /tmp/b-t1.log 2>&1; echo $?`
Expected: non-zero; the tool-list case fails on `get_escalation`, the table check fails on `escalations`.

- [ ] **Step 3: Delete and edit the code**

1. Delete the files in the Delete list. Keep `src/components/escalations/markers.ts` for Task 2 (move it there; until then leave it in place).
2. `src/contracts/identity.ts`: drop `'escalations:write'` from `ScopeSchema`. `src/server/http/identity-store.ts`: drop it from `browserScopes`. `src/components/settings/TokenCreate.tsx`: delete the `escalations:write` row.
3. `src/contracts/index.ts`: delete `export * from './escalations';`. `src/contracts/mcp.ts`: delete `analysisFreshness`.
4. `src/server/domain/graph/project.ts`: delete the `escalationAnalyses` query and `analysisFreshness`; return `{ project, context, pendingEvidenceCount, requestId }`. Remove the unused `desc`, `eq` and schema imports.
5. `src/server/mcp/tools.ts`: delete the three escalation tools and their imports.
6. `src/server/domain/seed/index.ts`: delete `ESCALATION_ANSWERS`, `seedEscalations`, its call and import; change the doc comment to "History, the revert and the drafts go through the same domain paths a person uses, …".
7. `src/server/db/schema.ts`: delete `escalations` and `escalationAnalyses` (and any relation or type that only they use).
8. Graph: in `graph/page.tsx` delete the `escalation` block (lines 93-120), the `getEscalation`, `EscalationFocus`, `citedLoops` and `AppError` imports if now unused, and both `escalation={…}` props. In `proposals/[proposalId]/page.tsx` delete `escalation={null}`. In `GraphScreen.tsx` delete `EscalationFocus`, the `escalation` prop, `escalationLoopIds`, its branch in `faded` and the three coverage sentences. In `filters.ts` delete `escalationId` (type, parse, the `'escalation'` key in the known-keys list, serialise) and the escalation sentence of the doc comment above `visibleLoops`.
9. `Rail.tsx`: delete the Escalations item and its `flag` icon if nothing else uses it.
10. Fixtures: delete `escalations` from `fixtures/story-source.json`; in `scripts/build-fixtures.ts` delete `ClaimSource`, `StorySource.escalations` and the gold `escalations` output. Rebuild: `node --experimental-strip-types scripts/build-fixtures.ts > /tmp/b-fx.log 2>&1; echo $?` → `0`. Check `git diff --stat fixtures/`: only `gold.json` and `story-source.json` change.
11. Migration: `./node_modules/.bin/drizzle-kit generate --name remove_escalations > /tmp/b-gen.log 2>&1; echo $?` → `0`. Append to the generated SQL:

```sql
--> statement-breakpoint
UPDATE "agent_tokens" SET "scopes" = array_remove("scopes", 'escalations:write');
```

- [ ] **Step 4: Update the shared tests**

- `rest.test.ts`: delete the 4 escalation routes from the route list (61-64), the `openEscalation` import and the two escalation cases (432-460).
- `security.test.ts`: delete the `escalationsRoute` import and the cases that call it (324-360).
- `seed.test.ts`: delete the escalation case (259-290) and its imports.
- `graph/read.test.ts`: delete `escalations` and `escalation_analyses` from the table list (49-50); delete the freshness case (350-375); expect no `analysisFreshness` key.
- `release.spec.ts:501`: delete `analysisFreshness`.
- `domain-boundaries.test.ts` and `review-fixes.test.ts`: delete the escalation imports and cases.
- `fixtures.test.ts:152-160`: delete the gold escalation case.
- `filters.test.ts`: delete `escalationId: null` (74), the escalation case (101-110) and `&escalation=2` from the junk-params case (120).
- `graph.spec.ts:267-280`: delete the escalation test. `shell.spec.ts:14`: expect `nav.getByRole('link', { name: 'Escalations' })` toHaveCount(0).
- `grep -rni escalat src tests scripts fixtures/*.ts` → only the `gmail:escalation-*` record keys may remain (`grep -rni escalat src tests scripts | grep -v 'gmail:escalation-'` prints nothing).

- [ ] **Step 5: Run the gates**

Run each with `> /tmp/b-<name>.log 2>&1; echo $?`: `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/eslint .`, `TEST_DATABASE_URL=… ./node_modules/.bin/vitest run`.
Expected: `0` each; vitest summary shows 0 failed.

- [ ] **Step 6: Commit**

```bash
git add -A src tests scripts fixtures
git commit -m "feat: remove escalations from pages, API, MCP, scopes, database and fixtures"
```

---

### Task 2: Note citations in the contract and the fixtures

**Files:**
- Create: `src/contracts/markers.ts`
- Delete: `src/components/escalations/markers.ts` (and the now empty folder), `tests/unit/escalations/markers.test.ts`
- Modify: `src/contracts/graph.ts:98-102`, `src/contracts/index.ts`, `src/server/domain/seed/index.ts:67-74`, `scripts/build-fixtures.ts:595-600`, `fixtures/story-source.json` (`history`), regenerated fixtures
- Test: `tests/unit/contracts/markers.test.ts` (new, from the old markers test), `tests/unit/fixtures/fixtures.test.ts`, `tests/integration/seed/seed.test.ts`, `tests/integration/proposals/*.test.ts` (one new case)

**Interfaces:**
- Produces (from `src/contracts`):
  - `ACT_MARKER: RegExp` (global, lowercase UUID)
  - `type NotePart = { kind: 'text'; text: string } | { kind: 'act'; actId: string }`
  - `noteParts(text: string): NotePart[]`
  - `markerErrors(text: string, actIds: readonly string[]): string[]`
- Produces (fixtures): main head holds 2 annotations; the newest has id `uuidFromKey('annotation:project-summary')`.

- [ ] **Step 1: Write the failing tests**

Move `tests/unit/escalations/markers.test.ts` to `tests/unit/contracts/markers.test.ts`, import `noteParts` from `../../../src/contracts/markers` and rename `renderMarkers` to `noteParts` in it. Delete its `answerPlainText` cases. Add:

```ts
import { AnnotationSchema } from '../../../src/contracts';
import { markerErrors } from '../../../src/contracts/markers';

describe('markerErrors', () => {
  it('accepts markers that cite acts in actIds', () => {
    expect(markerErrors(`Late [act:${A}].`, [A])).toEqual([]);
  });
  it('rejects a marker outside actIds and a malformed marker', () => {
    expect(markerErrors(`Late [act:${B}].`, [A])).toEqual([`Marker [act:${B}] is not in actIds`]);
    expect(markerErrors('Late [act:ABC].', [A])).toEqual([
      'Note markers must be [act:<lowercase uuid>]',
    ]);
  });
  it('makes the annotation schema report the error on text', () => {
    const result = AnnotationSchema.safeParse({ id: C, text: `See [act:${B}]`, actIds: [A] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['text']);
  });
});
```

In `fixtures.test.ts` add:

```ts
it('ends the history with a cited project summary note', () => {
  const head = history.at(-1)!;
  expect(head.message).toBe('Summarise where the project stands on 9 October');
  const note = head.snapshot.annotations.find(
    (item) => item.id === uuidFromKey('annotation:project-summary'),
  )!;
  expect(note.actIds).toHaveLength(5);
  expect(markerErrors(note.text, note.actIds)).toEqual([]);
  expect([...note.text.matchAll(ACT_MARKER)].map((match) => match[1])).toEqual(note.actIds);
});
```

In `seed.test.ts` add:

```ts
it('main holds the summary note with markers rekeyed to the sandbox acts', async () => {
  const { snapshot } = await headOf(t.db, project.id);
  const note = snapshot.annotations.at(-1)!;
  expect(note.text).toMatch(/^As of 9 October, 27 of 36 loops are closed\./);
  const acts = new Set(snapshot.acts.map((act) => act.id));
  for (const match of note.text.matchAll(ACT_MARKER)) expect(acts.has(match[1])).toBe(true);
});
```

In the proposals integration file that tests `updateProposal` validation, add:

```ts
it('rejects a note whose marker cites an act outside actIds', async () => {
  const act = base.acts[0].id, other = base.acts[1].id;
  await expect(
    updateProposal(t.db, ctx, {
      ...revisionBasis,
      operations: [
        { op: 'put', collection: 'annotations', value: { id: randomUUID(), text: `See [act:${other}]`, actIds: [act] } },
      ],
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: 'INVALID' });
});
```

Use the file's existing names for the base snapshot, context and revision basis.

- [ ] **Step 2: Run them and confirm they fail**

Run: `TEST_DATABASE_URL=… ./node_modules/.bin/vitest run tests/unit/contracts/markers.test.ts tests/unit/fixtures tests/integration/seed tests/integration/proposals > /tmp/b-t2.log 2>&1; echo $?` → non-zero (missing module, missing history step).

- [ ] **Step 3: Write `src/contracts/markers.ts`**

```ts
export const ACT_MARKER = /\[act:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/g;
const MARKER_OPEN = '[act:';

export type NotePart = { kind: 'text'; text: string } | { kind: 'act'; actId: string };

/** Notes are agent-written: callers render the parts as text nodes and buttons, never as HTML. */
export function noteParts(text: string): NotePart[] {
  const parts: NotePart[] = [];
  let at = 0;
  for (const match of text.matchAll(ACT_MARKER)) {
    if (match.index > at) parts.push({ kind: 'text', text: text.slice(at, match.index) });
    parts.push({ kind: 'act', actId: match[1] });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) });
  return parts;
}

export function markerErrors(text: string, actIds: readonly string[]): string[] {
  const markers = [...text.matchAll(ACT_MARKER)];
  const errors: string[] = [];
  if (markers.length !== text.split(MARKER_OPEN).length - 1)
    errors.push('Note markers must be [act:<lowercase uuid>]');
  const cited = new Set(actIds);
  for (const match of markers)
    if (!cited.has(match[1])) errors.push(`Marker ${match[0]} is not in actIds`);
  return errors;
}
```

Export it from `src/contracts/index.ts` (`export * from './markers';`).

- [ ] **Step 4: Add the rule to `AnnotationSchema`** (`src/contracts/graph.ts`)

```ts
export const AnnotationSchema = z
  .strictObject({
    id: IdSchema,
    text: z.string().min(1).max(10000),
    actIds: z.array(IdSchema).max(3000),
  })
  .superRefine((value, ctx) => {
    for (const message of markerErrors(value.text, value.actIds))
      ctx.addIssue({ code: 'custom', path: ['text'], message });
  });
```

- [ ] **Step 5: Rekey markers in the seed** (`src/server/domain/seed/index.ts`)

```ts
export function rekeyFixture<T>(value: T, ids: FixtureIds): T {
  const rekey = (id: string) => ids.versionIds.get(id) ?? ids.entityId(id);
  return JSON.parse(JSON.stringify(value), (_key, item) =>
    typeof item !== 'string'
      ? item
      : UUID.test(item)
        ? rekey(item)
        : item.replace(ACT_MARKER, (_match, id: string) => `[act:${rekey(id)}]`),
  ) as T;
}
```

Also change the seed commit message `'Seed Larkspur main snapshot'` to `'Larkspur history up to 9 October'` (spec 6.1) and update `tests/e2e/review.spec.ts:301` to the new text if that line still checks the newest item (it does not after Step 7: the newest item becomes the summary; assert on the oldest merge instead).

- [ ] **Step 6: Fixture builder markers** (`scripts/build-fixtures.ts`, the annotation loop)

```ts
const NOTE_MARKER = /\{act:([^}]+)\}/g;
// … inside `for (const note of step.annotations ?? [])`
const annotation: Annotation = {
  id: uuidFromKey(`annotation:${note.key}`),
  text: note.text.replace(NOTE_MARKER, (_match, key: string) =>
    note.acts.includes(key)
      ? `[act:${larkspur.actId(key)}]`
      : fail(`Note ${note.key} cites ${key} outside its acts`),
  ),
  actIds: note.acts.map(larkspur.actId),
};
```

- [ ] **Step 7: Add the history step and the Undo wording** (`fixtures/story-source.json`, `history`)

Change the revert step's message to `Undo "Ignore the out-of-office reply and note why Tom did not answer"`. Append after it:

```json
{
  "key": "project-summary",
  "kind": "merge",
  "message": "Summarise where the project stands on 9 October",
  "annotations": [
    {
      "key": "project-summary",
      "text": "As of 9 October, 27 of 36 loops are closed. Go-live and first close is at risk. Minh Trần moved go-live from 30 September to 15 October on 12 September {act:go-live#2}, and Sarah Kim agreed the next day {act:go-live#3}. On the same milestone, Daniel Reyes promised the sync root cause report by 3 October {act:incident-report#0} and has sent nothing since. Two items wait on the client: Tom Becker in IT has not answered Quang Nguyễn's request to renew the Azure client secret {act:secret#0}, and Priya Shah has not confirmed the side-letter mapping that Minh Trần delivered on 29 August {act:side-letter#2}.",
      "acts": ["go-live#2", "go-live#3", "incident-report#0", "secret#0", "side-letter#2"]
    }
  ]
}
```

Before the rebuild, check each claim against the engine: `deriveProject` at T gives 27 closed of 36, "Go-live and first close" `at_risk`, `incident-report` `silent_overdue`, `secret` `unanswered_request`, `side-letter` `unconfirmed_delivery`, and the dates of the 5 acts. If one differs, fix the sentence, not the data. Then rebuild: `node --experimental-strip-types scripts/build-fixtures.ts > /tmp/b-fx2.log 2>&1; echo $?` → `0`.

- [ ] **Step 8: Fix the counts that the new step changes**

Run `TEST_DATABASE_URL=… ./node_modules/.bin/vitest run > /tmp/b-t2-all.log 2>&1; echo $?`. Tests that count history commits (`history.length === 3`), expect the revert as the head, or expect 1 annotation on main now see 4 commits and 2 notes. Update each such expectation to the new fixture value; do not change the fixture to fit an old test.

- [ ] **Step 9: Run and commit**

Run the Step 2 command and the full vitest run → `0`, 0 failed. Then:

```bash
git add -A src tests scripts fixtures
git commit -m "feat: notes cite steps with [act:] markers; the fixture history ends with a project summary"
```

---

### Task 3: Notes on the Graph and in the loop panel

**Files:**
- Create: `src/components/notes/note-view.ts`, `src/components/notes/NoteText.tsx`, `src/components/notes/NotesCard.tsx`
- Modify: `src/components/graph/GraphScreen.tsx`, `src/components/graph/LoopPanel.tsx`, `src/components/review/describe.ts:58` (`'Annotation'` → `'Note'`), `src/app/globals.css`
- Test: `tests/unit/review/note-view.test.ts` (new), `tests/e2e/graph.spec.ts` (new case)

**Interfaces:**
- Consumes: `noteParts`, `NotePart` (Task 2); `Annotation` from `src/contracts`.
- Produces:
  - `type CitePart = { kind: 'text'; text: string } | { kind: 'cite'; actId: string; n: number }`
  - `noteView(note: Annotation): CitePart[]`
  - `<NoteText note actLoop onCite />` where `actLoop: ReadonlyMap<string, string>` maps act id → loop id and `onCite(loopId: string, actId: string): void`
  - `<NotesCard notes actLoop onCite />`

- [ ] **Step 1: Write the failing unit test** (`tests/unit/review/note-view.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { noteView } from '../../../src/components/notes/note-view';

const A = '94f5c370-711a-4039-9e20-a02d1fd5e70d',
  B = 'fe8cb040-d525-4e8b-9009-a911e6098e6b',
  N = '94e84396-211b-4c56-95bb-1464890069cc';

describe('noteView', () => {
  it('numbers markers in reading order and reuses a number for a repeated act', () => {
    expect(noteView({ id: N, text: `x [act:${B}] y [act:${A}] z [act:${B}]`, actIds: [A, B] })).toEqual([
      { kind: 'text', text: 'x ' },
      { kind: 'cite', actId: B, n: 1 },
      { kind: 'text', text: ' y ' },
      { kind: 'cite', actId: A, n: 2 },
      { kind: 'text', text: ' z ' },
      { kind: 'cite', actId: B, n: 1 },
    ]);
  });
  it('lists actIds after the text when the note has no marker', () => {
    expect(noteView({ id: N, text: 'Plain.', actIds: [A, B] })).toEqual([
      { kind: 'text', text: 'Plain.' },
      { kind: 'text', text: ' ' },
      { kind: 'cite', actId: A, n: 1 },
      { kind: 'cite', actId: B, n: 2 },
    ]);
  });
  it('keeps a malformed marker as text', () => {
    expect(noteView({ id: N, text: 'See [act:ABC].', actIds: [A] })).toEqual([
      { kind: 'text', text: 'See [act:ABC].' },
      { kind: 'text', text: ' ' },
      { kind: 'cite', actId: A, n: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `./node_modules/.bin/vitest run tests/unit/review/note-view.test.ts > /tmp/b-t3.log 2>&1; echo $?` → non-zero (module missing).

- [ ] **Step 3: Write `note-view.ts`**

```ts
import { noteParts, type Annotation } from '../../contracts';

export type CitePart = { kind: 'text'; text: string } | { kind: 'cite'; actId: string; n: number };

export function noteView(note: Annotation): CitePart[] {
  const numbers = new Map<string, number>();
  const number = (actId: string) => {
    if (!numbers.has(actId)) numbers.set(actId, numbers.size + 1);
    return numbers.get(actId)!;
  };
  const parts: CitePart[] = noteParts(note.text).map((part) =>
    part.kind === 'text' ? part : { kind: 'cite', actId: part.actId, n: number(part.actId) },
  );
  if (numbers.size === 0 && note.actIds.length) {
    parts.push({ kind: 'text', text: ' ' });
    for (const actId of note.actIds) parts.push({ kind: 'cite', actId, n: number(actId) });
  }
  return parts;
}
```

- [ ] **Step 4: Write `NoteText.tsx` and `NotesCard.tsx`**

```tsx
'use client';
import type { Annotation } from '../../contracts';
import { noteView } from './note-view';

export function NoteText({
  note,
  actLoop,
  onCite,
}: {
  note: Annotation;
  actLoop: ReadonlyMap<string, string>;
  onCite(loopId: string, actId: string): void;
}) {
  return (
    <p className="note-text">
      {noteView(note).map((part, index) => {
        if (part.kind === 'text') return <span key={index}>{part.text}</span>;
        const loopId = actLoop.get(part.actId);
        return loopId ? (
          <button
            key={index}
            type="button"
            className="cite"
            aria-label={`Open step ${part.n}`}
            onClick={() => onCite(loopId, part.actId)}
          >
            {part.n}
          </button>
        ) : (
          <span key={index} className="cite off" title="This step is not on the graph at this date">
            {part.n}
          </span>
        );
      })}
    </p>
  );
}
```

```tsx
'use client';
import { useState } from 'react';
import type { Annotation } from '../../contracts';
import { NoteText } from './NoteText';

export function NotesCard({
  notes,
  actLoop,
  onCite,
}: {
  notes: readonly Annotation[];
  actLoop: ReadonlyMap<string, string>;
  onCite(loopId: string, actId: string): void;
}) {
  const [all, setAll] = useState(false);
  if (!notes.length) return null;
  const shown = all ? [...notes].reverse() : [notes.at(-1)!];
  return (
    <section className={`notes-card${all ? ' open' : ''}`} aria-label="Notes">
      <header>
        <b>Notes</b>
        <span className="faint">Interpretation, not evidence</span>
        <button type="button" className="link" onClick={() => setAll(!all)}>
          {all ? 'Show less' : notes.length > 1 ? `Show all notes (${notes.length})` : 'Show more'}
        </button>
      </header>
      {shown.map((note) => (
        <NoteText key={note.id} note={note} actLoop={actLoop} onCite={onCite} />
      ))}
    </section>
  );
}
```

CSS in `src/app/globals.css`, next to the `.coverage` rules: `.notes-card` (card border, 10px 14px padding, `var(--panel)` background), `.notes-card header` (flex, gap 8px, 12px font), `.notes-card:not(.open) .note-text` (`-webkit-line-clamp: 3; display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden`), `.cite` (600 11px, `var(--route)` on `var(--route-bg)`, radius 4px, padding 0 4px, margin-left 2px, no border, pointer) and `.cite.off` (`var(--isolated)` on `var(--isolated-bg)`, default cursor).

- [ ] **Step 5: Wire them in `GraphScreen.tsx` and `LoopPanel.tsx`**

`GraphScreen`: change the `snapshot` prop type to `Pick<GraphSnapshot, 'acts' | 'recordDecisions' | 'annotations'>`. Add:

```ts
const actLoop = useMemo(
  () => new Map(engine.loops.flatMap((item) => item.acts.map((act) => [act.id, item.loop.id] as const))),
  [engine],
);
const loopNotes = useMemo(
  () =>
    selectedLoop
      ? snapshot.annotations.filter((note) => note.actIds.some((id) => actLoop.get(id) === selectedLoop.loop.id))
      : [],
  [snapshot.annotations, actLoop, selectedLoop],
);
```

Render `<NotesCard notes={snapshot.annotations} actLoop={actLoop} onCite={selectLoop} />` between `<FilterBar … />` and `<p className="coverage">`. Pass `notes={loopNotes}`, `actLoop={actLoop}` and `onCite={selectLoop}` to `LoopPanel`. In `LoopPanel`, add the props and render, after the `parties` block:

```tsx
{notes.length > 0 && (
  <section className="panel-notes" aria-label="Notes">
    <small>Notes</small>
    {notes.map((note) => (
      <NoteText key={note.id} note={note} actLoop={actLoop} onCite={onCite} />
    ))}
  </section>
)}
```

The graph page and the change-set page pass the full snapshot already; `tsc` confirms.

- [ ] **Step 6: Write the e2e case** (`tests/e2e/graph.spec.ts`)

```ts
test('the Notes card shows the summary, and a cite opens the loop panel at that step', async ({ page }) => {
  await signIn(page, 'graph-notes');
  const card = page.getByRole('region', { name: 'Notes' });
  await expect(card).toContainText('As of 9 October, 27 of 36 loops are closed.');
  await card.getByRole('button', { name: 'Open step 3' }).click();
  const panel = page.getByRole('complementary', { name: /Sync incident report/ });
  await expect(panel).toBeVisible();
  await expect(panel.locator('[aria-current="step"]')).toContainText('Promise');
});
```

Match the panel and current-step selectors to the ones the existing "a press on an event card opens its loop at that act" test uses.

Add the Review Focus 2 case:

```ts
test('a cite to a step after the As-of time is grey and not a button', async ({ page }) => {
  await signIn(page, 'graph-notes-asof');
  await page.goto(`${page.url().split('?')[0]}?t=2026-09-20T12:00:00%2B07:00`);
  const card = page.getByRole('region', { name: 'Notes' });
  // The sync report promise (cite 3) is dated 1 October, after this As-of time.
  await expect(card.getByRole('button', { name: 'Open step 3' })).toHaveCount(0);
  await expect(card.locator('.cite.off', { hasText: '3' })).toHaveAttribute('title', /not on the graph/);
});
```

- [ ] **Step 7: Run and commit**

Run: `./node_modules/.bin/vitest run tests/unit > /tmp/b-t3u.log 2>&1; echo $?` → `0`; `TEST_DATABASE_URL=… E2E_PORT=3300 ./node_modules/.bin/playwright test tests/e2e/graph.spec.ts -g "Notes card" > /tmp/b-t3e.log 2>&1; echo $?` → `0`, `1 passed`.

```bash
git add -A src tests
git commit -m "feat: notes card above the graph and notes in the loop panel, with numbered step links"
```

---

### Task 4: First view fits the project; a loop-list click opens the panel

**Files:**
- Modify: `src/components/graph/PromiseGraph.tsx:362-372` (first view), `:477-518` (list and jump), `:938-960` and `:1068-1078` (render), `src/components/graph/GraphScreen.tsx` (pass `panelOpen`, `onClosePanel`), `docs/superpowers/specs/2026-10-12-promise-graph-srd.md:315` ("The first view …")
- Test: `tests/e2e/graph.spec.ts` (282, 571, 695 and every case that needs 100 %)

**Interfaces:**
- Produces: `PromiseGraphProps.panelOpen: boolean`, `PromiseGraphProps.onClosePanel(): void`.

- [ ] **Step 1: Write the failing e2e cases**

Rename the case at 282 to `'the canvas opens fitted to the project, the wheel moves it, and Ctrl + wheel zooms it'` and replace `expect(await zoomOf(page)).toBe(1);` (both places) with:

```ts
const fitted = await zoomOf(page);
expect(fitted).toBeLessThan(0.2);
```

and later `expect(await zoomOf(page)).toBe(fitted);` and `toBeGreaterThan(fitted)`. Add a helper near `zoomOf`:

```ts
async function atHundred(page: Page) {
  await page.getByRole('button', { name: /zoom level/i }).click();
  await page.getByRole('menuitem', { name: '100 %' }).click();
  await expect.poll(() => zoomOf(page)).toBe(1);
}
```

Use the real names of the % menu button and its 100 % item from `CanvasControls.tsx`. Rewrite the loop-list case at 571:

```ts
test('a loop-list click opens the panel and hides the list; closing the panel brings the list back', async ({ page }) => {
  await signIn(page, 'graph-list');
  const list = page.getByRole('complementary', { name: /Loops/ });
  await list.getByRole('button', { name: 'Sync incident report' }).click();
  await expect(page.getByRole('button', { name: 'Close loop panel' })).toBeVisible();
  await expect(list).toBeHidden();
  // Review Focus 4: the panel switches loops while the list stays hidden.
  await page.getByRole('button', { name: 'Open loop list' }).click();
  await expect(page.getByRole('button', { name: 'Close loop panel' })).toBeHidden();
  await list.getByRole('button', { name: 'Go-live date' }).click();
  await expect(page.getByRole('heading', { name: 'Go-live date' })).toBeVisible();
  await page.getByRole('button', { name: 'Close loop panel' }).click();
  await expect(list).toBeVisible();
});
```

Use the real accessible names of the list region, its toggle and its row buttons from `LoopIndex.tsx` and `CanvasControls.tsx`. Keep the "Show only … until Show all" checks in this case through the row's Show only button.

- [ ] **Step 2: Run them and confirm they fail**

Run: `TEST_DATABASE_URL=… E2E_PORT=3300 ./node_modules/.bin/playwright test tests/e2e/graph.spec.ts -g "fitted|loop-list click" > /tmp/b-t4.log 2>&1; echo $?` → non-zero.

- [ ] **Step 3: First view** (`PromiseGraph.tsx`)

Move the `placed` effect below the `fit` callback and change it to:

```ts
// Direction B, V1: the first view shows the whole project, not 10 days around T.
const placed = useRef(false);
useEffect(() => {
  if (placed.current || size.width === 0) return;
  placed.current = true;
  const view = fitViewport(content, size);
  void flow.setViewport({ ...view, y: TRUNK_VIEW_TOP - trunkAt(view.zoom) });
}, [size, flow, content, trunkAt]);
```

- [ ] **Step 4: List and panel** (`PromiseGraph.tsx`, `GraphScreen.tsx`)

Add `panelOpen: boolean` and `onClosePanel(): void` to `PromiseGraphProps` and destructure them. Then:

```ts
const listShown = listOpen && !panelOpen;
const jump = useCallback(
  (loopId: string) => {
    setActiveId(loopId);
    onSelectLoop(loopId);
    if (layout.branches.some((branch) => branch.loopId === loopId)) zoomToLoop(loopId);
    else {
      pendingJump.current = loopId;
      index.onToggleOnly(loopId);
    }
  },
  [layout, zoomToLoop, index, onSelectLoop],
);
const toggleList = useCallback(() => {
  if (panelOpen && listOpen) {
    onClosePanel();
    return;
  }
  setListOpen((value) => { /* unchanged body */ });
}, [panelOpen, listOpen, onClosePanel]);
```

Replace `listOpen` with `listShown` in the stage class name, the `--list-w` style, the list `ResizeHandle`, the `LoopIndex` render and the `listOpen` prop of `CanvasControls`. In `GraphScreen` pass `panelOpen={panelOpen}` and `onClosePanel={close}`.

- [ ] **Step 5: Fix the cases that assumed 100 % or both side panels**

Run the whole file: `TEST_DATABASE_URL=… E2E_PORT=3300 ./node_modules/.bin/playwright test tests/e2e/graph.spec.ts > /tmp/b-t4all.log 2>&1; echo $?`. For each failing case that reads cards, drags cards or measures icons, add `await atHundred(page);` after `signIn`. For the resize case at 695, resize the list first, then open the panel and check that the list hides. Do not change app code in this step. Rerun → `0`.

- [ ] **Step 6: SRD line and commit**

In SRD 7.2 replace "The first view is 100 % with T at 80 % of the width and the trunk at the centre." with "The first view fits the whole project, with the trunk at the top (direction B, 15 October 2026)." In SRD 7.3b add: "A click on a loop name opens its panel; the list hides while a panel is open and comes back when the panel closes."

```bash
git add -A src tests docs/superpowers/specs/2026-10-12-promise-graph-srd.md
git commit -m "feat: the graph opens fitted to the project; a loop-list click opens the loop panel"
```

---

### Task 5: Past problems and party labels

**Files:**
- Create: `src/components/graph/ProblemTag.tsx`
- Modify: `src/components/graph/labels.ts`, `src/components/graph/LoopList.tsx:55-56,100-115`, `src/components/graph/LoopPanel.tsx:332-336,350-360,364-372`, `src/components/graph/MilestonePanel.tsx:75-78`, `src/components/graph/GraphScreen.tsx:389-402,420-430`, `src/components/review/LoopEditor.tsx:112,124,136`, `src/components/review/ActEditor.tsx:160,172`, `src/app/globals.css:408,1501`
- Test: `tests/unit/graph/labels.test.ts` (new or existing), `tests/e2e/graph.spec.ts` (list view case)

**Interfaces:**
- Produces in `labels.ts`: `isEnded(state: LoopState | null): boolean`; `type ProblemTone = 'broken' | 'warning' | 'past'`; `problemTone(loop: DerivedLoop, item: Breakdown): ProblemTone`; `PROBLEM_MARK: Record<ProblemTone, string>`; `PROBLEM_HEADING: Record<ProblemTone, string>`; `problemCounts(loops: readonly DerivedLoop[]): { broken: number; warning: number; past: number }`. `loopColor` keeps its signature.

- [ ] **Step 1: Write the failing unit test**

```ts
import { describe, expect, it } from 'vitest';
import { loopColor, problemCounts, problemTone, TONE_COLOR } from '../../../src/components/graph/labels';
import type { DerivedLoop } from '../../../src/contracts/engine';

const late = { type: 'late_delivery', severity: 'broken', sentence: 'Late.', proofActIds: [], startAt: '2026-07-10T00:00:00Z', endAt: '2026-07-24T00:00:00Z' } as DerivedLoop['breakdowns'][number];
const loop = (state: DerivedLoop['state'], breakdowns = [late]) => ({ state, breakdowns, dueSoon: false }) as unknown as DerivedLoop;

describe('past problems', () => {
  it('colours a finished loop by its end, whatever happened before', () => {
    expect(loopColor(loop('closed'))).toBe(TONE_COLOR.green);
    expect(loopColor(loop('cancelled'))).toBe(TONE_COLOR.gray);
    expect(loopColor(loop('promised'))).toBe(TONE_COLOR.red);
  });
  it('marks a problem on a finished loop as past', () => {
    expect(problemTone(loop('closed'), late)).toBe('past');
    expect(problemTone(loop('promised'), late)).toBe('broken');
  });
  it('counts only current problems as broken or warning', () => {
    expect(problemCounts([loop('closed'), loop('promised'), loop('delivered', [{ ...late, severity: 'warning' }])])).toEqual({ broken: 1, warning: 1, past: 1 });
  });
});
```

Match the `BreakdownSchema` fields in `src/contracts/engine.ts:61` when you build `late`.

- [ ] **Step 2: Run it and confirm it fails**

Run: `./node_modules/.bin/vitest run tests/unit/graph/labels.test.ts > /tmp/b-t5.log 2>&1; echo $?` → non-zero.

- [ ] **Step 3: Implement in `labels.ts`**

```ts
type Breakdown = DerivedLoop['breakdowns'][number];
export const isEnded = (state: LoopState | null) =>
  state === 'closed' || state === 'declined' || state === 'cancelled';
export type ProblemTone = 'broken' | 'warning' | 'past';
export const problemTone = (loop: DerivedLoop, item: Breakdown): ProblemTone =>
  isEnded(loop.state) ? 'past' : item.severity;
export const PROBLEM_MARK: Record<ProblemTone, string> = { broken: '✕', warning: '!', past: 'Past:' };
export const PROBLEM_HEADING: Record<ProblemTone, string> = {
  broken: '✕ Broken',
  warning: '! Warning',
  past: 'Past problem',
};
export function problemCounts(loops: readonly DerivedLoop[]) {
  const current = loops.filter((loop) => !isEnded(loop.state));
  const broken = current.filter((loop) => loop.breakdowns.some((item) => item.severity === 'broken')).length;
  return {
    broken,
    warning: current.filter((loop) => loop.breakdowns.length).length - broken,
    past: loops.filter((loop) => isEnded(loop.state) && loop.breakdowns.length).length,
  };
}

/** The colour of a loop as a whole: a finished loop shows its end; an open one shows its worst problem. */
export function loopColor(loop: DerivedLoop): string {
  if (loop.state === 'closed') return TONE_COLOR.green;
  if (loop.state === 'declined' || loop.state === 'cancelled') return TONE_COLOR.gray;
  if (loop.breakdowns.some((item) => item.severity === 'broken')) return TONE_COLOR.red;
  if (loop.breakdowns.length || loop.dueSoon) return TONE_COLOR.amber;
  return TONE_COLOR.blue;
}
```

`ProblemTag.tsx`:

```tsx
import type { DerivedLoop } from '../../contracts/engine';
import { BREAKDOWN_LABEL, PROBLEM_MARK, problemTone } from './labels';

export function ProblemTag({ loop, item }: { loop: DerivedLoop; item: DerivedLoop['breakdowns'][number] }) {
  const tone = problemTone(loop, item);
  return (
    <span className={`bd ${tone}`} title={item.sentence}>
      {PROBLEM_MARK[tone]} {BREAKDOWN_LABEL[item.type]}
    </span>
  );
}
```

Use `<ProblemTag loop={loop} item={item} key={item.type} />` in `LoopList`, `MilestonePanel` and the `LoopPanel` header row. In the `LoopPanel` problem list use `` className={`bdrow ${problemTone(loop, item)}`} `` and `PROBLEM_HEADING[problemTone(loop, item)]`. CSS: add `.bd.past` and `.bdrow.past` beside the `.warning` rules with `color: var(--muted)` and `background: var(--isolated-bg)`.

- [ ] **Step 4: Coverage line** (`GraphScreen.tsx`)

Replace the `broken` and `warning` lines of `counts` with `...problemCounts(visibleLoops)`. After the "declined or cancelled" text add:

```tsx
{counts.past > 0 && (
  <span>
    {counts.past} finished {counts.past === 1 ? 'loop' : 'loops'} had a problem earlier.
  </span>
)}
```

- [ ] **Step 5: Party labels**

`LoopPanel.tsx`: `Customer` → `Requested by`, `Performer` → `Done by`. `LoopList.tsx`: `Performer department` → `Department`, `Customer` → `Requested by`. `LoopEditor.tsx`: `Customer` → `Requested by`, `Performer` → `Done by`, `Performer department` → `Department`. `ActEditor.tsx`: the same two. Then `grep -rn "'Customer'\|>Customer<\|\"Customer\"\|Performer" src/components tests/e2e` and update any e2e selector that used the old words.

- [ ] **Step 6: Run and commit**

Run: `./node_modules/.bin/vitest run tests/unit > /tmp/b-t5u.log 2>&1; echo $?` → `0`. Run `graph.spec.ts`, `review.spec.ts` and `review-queue.spec.ts` with `TEST_DATABASE_URL=… E2E_PORT=3300` → `0`.

```bash
git add -A src tests
git commit -m "feat: problems on finished loops show as past; parties read Requested by and Done by"
```

---

### Task 6: Activity words and the duplicate key

**Files:**
- Modify: `src/components/history/CommitDiff.tsx`, `src/components/history/RevertRestorePreview.tsx:181,220,227`, `src/app/(app)/projects/[id]/history/history-screen.tsx:184`, `src/server/domain/commits/revert.ts:127`
- Test: `tests/e2e/review.spec.ts:242` and the Activity cases, `tests/unit/review/*` if one pins "Collection"

- [ ] **Step 1: Write the failing e2e check**

In the existing Activity e2e case (`review.spec.ts`, near 290-310), collect console errors and assert the words:

```ts
const errors: string[] = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.goto(`${projectPath}/history`);
await expect(page.getByRole('columnheader', { name: 'Kind' })).toBeVisible();
await expect(page.getByRole('columnheader', { name: 'Collection' })).toHaveCount(0);
await expect(page.getByText(/^Undo "Ignore the out-of-office reply/)).toBeVisible();
expect(errors.filter((text) => text.includes('same key'))).toEqual([]);
```

Change `review.spec.ts:242` to `/^Undo: Ignore the out-of-office reply/`.

- [ ] **Step 2: Run it and confirm it fails**

Run: `TEST_DATABASE_URL=… E2E_PORT=3300 ./node_modules/.bin/playwright test tests/e2e/review.spec.ts > /tmp/b-t6.log 2>&1; echo $?` → non-zero.

- [ ] **Step 3: Implement**

- `CommitDiff.tsx`: `COLLECTION` values → `acts: 'Step'`, `loops: 'Loop'`, `annotations: 'Note'`, `recordDecisions: 'Record decision'`, `people: 'Person'`, `departments: 'Department'`, `milestones: 'Milestone'`, `context: 'Project settings'`; headers `Collection` → `Kind`, `Entity` → `Item`; `'entity' : 'entities'` → `'item' : 'items'`; `aria-label="Commit changes"` → `"Changes in this version"`.
- `RevertRestorePreview.tsx`: the same header words; collection cells use the same labels (export `COLLECTION` from `CommitDiff.tsx` and import it).
- `history-screen.tsx:184`: `<details key={`tech-${commit.id}`} className="tech">`.
- `revert.ts:127`: `` title: `Undo: ${target.message}`.slice(0, 200), ``. Update any integration test that pins `Revert:` (`grep -rn "Revert: " tests`).

- [ ] **Step 4: Run and commit**

Run the Step 2 command → `0`. Run `TEST_DATABASE_URL=… ./node_modules/.bin/vitest run tests/integration/history > /tmp/b-t6i.log 2>&1; echo $?` → `0`.

```bash
git add -A src tests
git commit -m "fix: Activity uses plain words and no duplicate React key"
```

---

### Task 7: Settings: plain scope words and the last call of a token

**Files:**
- Modify: `src/server/db/schema.ts:331-340`, `src/contracts/identity.ts:44-54`, `src/server/http/identity-store.ts` (port), `src/server/db/identity-store.ts`, `tests/unit/auth/test-store.ts`, `src/server/http/actors.ts:95`, the token creation domain (wherever `AgentToken` objects are built; `tsc` lists them), `src/components/settings/TokenCreate.tsx`, `src/components/settings/TokenList.tsx`, `src/components/settings/SecretReveal.tsx`, `src/components/settings/McpSnippet.tsx`
- Create: `src/server/db/migrations/0003_token_last_call.sql` (generated) and meta
- Test: `tests/unit/auth/*.test.ts` (actors), `tests/integration/db/identity-store.test.ts`, `tests/e2e/shell.spec.ts` or the Settings e2e case

**Interfaces:**
- Produces: `AgentToken.lastUsedAt: string | null`; `HttpIdentityStore.touchToken(tokenId: string, at: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Unit (the actors test file that uses `tests/unit/auth/test-store.ts`):

```ts
it('records the last call at most once a minute', async () => {
  const { actors, store, clock, bearer } = await tokenSetup(); // the file's existing token fixture
  await actors.getTokenActor(bearer(), 'project:read');
  const first = store.tokens[0].lastUsedAt;
  expect(first).not.toBeNull();
  clock.advance(30_000);
  await actors.getTokenActor(bearer(), 'project:read');
  expect(store.tokens[0].lastUsedAt).toBe(first);
  clock.advance(31_000);
  await actors.getTokenActor(bearer(), 'project:read');
  expect(store.tokens[0].lastUsedAt).not.toBe(first);
});
it('records a call that fails on scope, because the agent still reached the app', async () => {
  const { actors, store, bearer } = await tokenSetup({ scopes: ['project:read'] });
  await expect(actors.getTokenActor(bearer(), 'graph:merge')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(store.tokens[0].lastUsedAt).not.toBeNull();
});
```

Adapt the names to the file's real setup helpers and clock. Integration (`identity-store.test.ts`):

```ts
it('touchToken sets lastUsedAt and listTokens returns it', async () => {
  await store.touchToken(tokenId, '2026-10-15T16:10:00.000Z');
  expect((await store.getTokenByHash(hash))!.lastUsedAt).toBe('2026-10-15T16:10:00.000Z');
  const [listed] = await store.listTokens({ userId, workspaceId, projectId, offset: 0, limit: 10 });
  expect(listed.lastUsedAt).toBe('2026-10-15T16:10:00.000Z');
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `TEST_DATABASE_URL=… ./node_modules/.bin/vitest run tests/unit/auth tests/integration/db/identity-store.test.ts > /tmp/b-t7.log 2>&1; echo $?` → non-zero.

- [ ] **Step 3: Schema, migration, contract, store**

- `schema.ts` `agentTokens`: add `lastUsedAt: tz('last_used_at'),` after `revokedAt`. Generate: `./node_modules/.bin/drizzle-kit generate --name token_last_call > /tmp/b-gen2.log 2>&1; echo $?` → `0`; the SQL is one `ALTER TABLE "agent_tokens" ADD COLUMN "last_used_at" timestamp with time zone;`.
- `AgentTokenSchema`: add `lastUsedAt: TimestampSchema.nullable(),`.
- Port: add `/** Called on every authenticated agent call; the caller limits it to once a minute. */ touchToken(tokenId: string, at: string): Promise<void>;`.
- `DbIdentityStore`: map `lastUsedAt: row.lastUsedAt === null ? null : toIso(row.lastUsedAt)` in `getTokenByHash` and `listTokens`; insert `lastUsedAt: token.lastUsedAt`; add

```ts
async touchToken(tokenId: string, at: string): Promise<void> {
  await this.db.update(agentTokens).set({ lastUsedAt: at }).where(eq(agentTokens.id, tokenId));
}
```

- `tests/unit/auth/test-store.ts`: implement `touchToken` by setting `lastUsedAt` on the stored token.
- Token creation: set `lastUsedAt: null` where `tsc` reports the missing field.

- [ ] **Step 4: Record the call** (`actors.ts`, after `limiter.consume(…)` and before the scope check)

```ts
const at = now();
if (!token.lastUsedAt || at - Date.parse(token.lastUsedAt) >= 60_000)
  await store.touchToken(token.id, new Date(at).toISOString());
```

- [ ] **Step 5: Settings UI**

`TokenCreate.tsx` `SCOPES` becomes `{ scope, title, text, risk? }[]`:

```ts
const SCOPES: { scope: Scope; title: string; text: string; risk?: true }[] = [
  { scope: 'project:read', title: 'Read the project', text: 'Records, the graph, notes and activity.' },
  { scope: 'records:import', title: 'Add records', text: 'Paste or import messages. The graph does not change.' },
  { scope: 'graph:propose', title: 'Suggest changes', text: 'Change sets wait for a person to approve them.' },
  {
    scope: 'graph:merge',
    title: 'Approve without you',
    text: 'The agent can approve and undo changes. Grant it only to an agent that you direct.',
    risk: true,
  },
];
```

Render `title` in bold and the code in `<span className="id faint">` after it. The "Scopes" legend becomes "Permissions".

`TokenList.tsx`: column `Scopes` → `Permissions` (titles joined by ", "; "No permissions" for an empty list); add column `Last call` with `token.lastUsedAt ? shortStamp(token.lastUsedAt, timeZone) : 'Never'` (pass the project time zone from the page if the component does not have it); add above the table:

```tsx
<button type="button" className="btn" onClick={() => router.refresh()}>
  Check again
</button>
```

`SecretReveal.tsx`: after the secret, add `<p className="faint">Ask your agent to list its tools. Then press Check again: Last call shows the time of that call.</p>`.

`McpSnippet.tsx`: replace the "MCP endpoint, Streamable HTTP with a bearer token:" sentence with "Paste this into your agent's MCP settings. Replace inv_... with the secret of your token. Address:" and keep the endpoint span and its test id.

- [ ] **Step 6: E2E**

In the Settings e2e case (or a new one in `shell.spec.ts`): create a token, check the row shows `Never`, call the MCP endpoint with the secret through `page.request.post('/mcp', { headers: { Authorization: `Bearer ${secret}`, … }, data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })` with the headers that `tests/integration/adapters/mcp.test.ts` sends, press "Check again", and expect the Last call cell to match `/\d{1,2} [A-Z][a-z]{2} \d{2}:\d{2}/`.

- [ ] **Step 7: Run and commit**

Run the Step 2 command → `0`; full `vitest run` → `0`; the Settings e2e case → `0`.

```bash
git add -A src tests
git commit -m "feat: Settings shows plain permission names and when each token last called the app"
```

---

### Task 8: Docs, full gates and the local app

**Files:**
- Modify: `README.md` (escalation lines, a "Notes" paragraph, screenshots list if it names escalation shots), `docs/mcp-agent-recipe.md` (step 3 scopes line 9, new section 3b), `src/server/mcp/tools.ts` (`update_proposal` description), SRD sections listed in spec 3.1, `fixtures/README.md` (escalations rows, history row: 4 steps)

- [ ] **Step 1: Docs**

- Recipe 3b, "Write a summary note": 1. `get_graph` for main. 2. Write one note; cite each step as `[act:<act id>]` and list every cited id in `actIds`. 3. `create_proposal`, then `update_proposal` with `{ "op": "put", "collection": "annotations", "value": { "id": "<uuid>", "text": "…", "actIds": [ … ] } }`. 4. A person approves it on the Review screen. Note: a marker outside `actIds` fails with a field error on `text`.
- `update_proposal` description: append " A note (annotations) may cite steps as [act:<id>]; every cited id must be in its actIds."
- SRD: delete the escalation bullets, scope, tables, tools, routes, tests and story lines (`grep -n -i escalat` lists them); add a short "Notes" paragraph to section 7 that matches spec section 4.
- README: delete the escalation lines; add one paragraph on notes.

- [ ] **Step 2: Full gates in a separate worktree**

```bash
git worktree add --detach /private/tmp/claude-501/-Users-latotheluu-orca-workspaces-cybernetics-tropicbird/530c3946-61da-4c51-8971-f4d3df66dbcc/scratchpad/dirb-gates HEAD
```

Copy `node_modules` with `cp -cR`, then run each with `> /tmp/b-g-<name>.log 2>&1; echo $?` and read the summary line: `tsc --noEmit`, `eslint .`, `prettier --check .`, `node scripts/check-no-model-dependencies.mjs`, `vitest run` (with `TEST_DATABASE_URL`), `playwright test` (with `TEST_DATABASE_URL` and `E2E_PORT=3300`), `next build`. Then `git worktree remove --force` the gates worktree.

- [ ] **Step 3: Run the app for the owner**

Restart the dev server of `dirb` on port 3100 against a fresh database `pg_dirb` (drop and recreate it, run `drizzle-kit migrate`), sign in once, and take screenshots of Graph (light and dark, 1440 and 390 px), the loop panel with notes, Activity and Settings. Check no console error on each screen.

- [ ] **Step 4: Commit**

```bash
git add -A README.md docs fixtures/README.md src/server/mcp/tools.ts
git commit -m "docs: notes replace escalations in the README, SRD and agent recipe"
```
