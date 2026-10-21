# Linear Tickets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A promise loop can have developer tickets as child loops. The board shows a progress chip on the parent, expands the tickets under it, and the demo carries five Linear tickets that an agent would import.

**Architecture:** One optional snapshot field, `Loop.parentLoopId`, with reference rules in the shared reference checker, so validation, rebase and revert all see them. The engine stays the same. The pure layout packs a parent and its expanded tickets as one block of rows. The browser derives ticket progress from engine loops. Linear data enters through the existing agent tools.

**Tech Stack:** TypeScript 5.9, Next.js 16.4, React 19.2, `@xyflow/react` 12, Zod 4.6, Vitest 4.1, Playwright 1.64, PostgreSQL 17.

**Spec:** [Linear tickets design](../specs/2026-10-14-linear-tickets-design.md). **Mockup:** [docs/design/2026-10-14-linear-tickets.html](../../design/2026-10-14-linear-tickets.html). **Depends on:** [Graph declutter plan](2026-10-14-graph-declutter.md), merged forward into `phucluu/promise-graph`.

## Global Constraints

- Branch `phucluu/linear-tickets` from `origin/phucluu/promise-graph` after the declutter merge forward. Work in a separate worktree.
- Commit identity: `PhucLuu-091005 <187116949+PhucLuu-091005@users.noreply.github.com>`. Never add `Co-Authored-By` or any other AI trailer.
- Run pnpm as `npx pnpm@11.25.0 <script>`. Test environment variables as in the declutter plan.
- Capture real exit codes (`cmd > log 2>&1; echo $?`) and read the summary lines.
- Prettier before every commit (`npx pnpm@11.25.0 format`). Comments explain WHY only.
- A top-level loop has **no** `parentLoopId` key. Never write `parentLoopId: null` or `parentLoopId: undefined`; copy with `...(parentLoopId ? { parentLoopId } : {})`.
- One level only. A ticket has `milestoneId: null`.
- Ticket progress: `done` = state `delivered` or `closed`; `total` = state not `declined` and not `cancelled`.
- Chip: 50 × 16 px at `xEnd + 8` (`xEnd + 20` for a parent that merges into the trunk). Reserve that room in packing.
- Expanded parents live in React state only.
- Linear demo permalinks: `https://linear.app/fundline/issue/{KEY}/{slug}`. Gmail demo permalinks: `https://mail.google.com/mail/u/0/#all/{externalId with ':' replaced by '-'}`.

## Review Focus

1. Rebase of a proposal that adds a ticket onto a main that removed the parent: the ticket shows as a conflict, never a silent dangling reference. Test in Task 1.
2. A user edits a ticket in the loop editor: the ticket stays a ticket, and a top-level loop never gains a `parentLoopId` key. Test in Task 2 (`loopValue`).
3. A search that matches only a ticket: the parent stays on the graph, and the list shows the ticket under it. Tests in Tasks 3 and 6.
4. A parent dragged up or down while expanded: its tickets' fork curves follow the parent's line. Test in Task 4.
5. A proposal snapshot from before this change (no key on any loop): it hashes and diffs as before. Test in Task 1.

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/contracts/graph.ts` | `parentLoopId` on `LoopSchema` | 1 |
| `src/server/graph/references.ts` | Parent and ticket rules | 1 |
| `src/components/review/describe.ts` | "parent loop" label | 2 |
| `src/components/review/loop-value.ts` (new), `LoopEditor.tsx`, `ProposalWorkspace.tsx` | Keep and edit the parent | 2 |
| `src/lib/graph-layout/tickets.ts` (new) | `ticketProgress` | 3 |
| `src/components/graph/filters.ts` | `withTickets` | 3 |
| `src/contracts/layout.ts` | `expandedLoopIds`, `parentLoopId`, `forkY`, `tickets` | 4 |
| `src/lib/graph-layout/index.ts` | Block packing, ticket branches | 4 |
| `src/lib/graph-layout/offsets.ts` | Ticket fork follows the parent | 4 |
| `src/components/graph/BranchEdge.tsx`, `ui-context.ts`, `PromiseGraph.tsx`, `GraphScreen.tsx` | Chip, expand state, coverage line | 5 |
| `src/components/graph/LoopPanel.tsx`, `LoopList.tsx` | Tickets section, parent line, indented rows | 6 |
| `scripts/build-fixtures.ts`, `fixtures/story-source.json`, `fixtures/*.json`, `fixtures/README.md` | Demo tickets and real-domain permalinks | 7 |
| `docs/mcp-agent-recipe.md`, `src/server/mcp/tools.ts`, `docs/superpowers/specs/2026-10-12-promise-graph-srd.md` | Agent recipe and SRD | 8 |

---

### Task 1: `parentLoopId` and its reference rules

**Files:**
- Modify: `src/contracts/graph.ts:76-83` (`LoopSchema`)
- Modify: `src/server/graph/references.ts`
- Test: `tests/unit/graph/ticket-references.test.ts` (new), `tests/integration/proposals/tickets.test.ts` (new)

**Interfaces:**
- Produces: `Loop.parentLoopId?: string`; reference error messages exactly as in the spec 3.2.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/graph/ticket-references.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import main from '../../../fixtures/main-snapshot.json';
import type { GraphSnapshot, Loop } from '../../../src/contracts';
import { diffSnapshots } from '../../../src/server/graph/diff';
import { threeWayRebase } from '../../../src/server/graph/rebase';
import { referenceErrors } from '../../../src/server/graph/references';
import { canonicalHash } from '../../../src/lib/canonical-json';

const base = main as GraphSnapshot;
const parent = base.loops.find((loop) => loop.parentLoopId === undefined)!;
const ticket = (overrides: Partial<Loop> = {}): Loop => ({
  id: randomUUID(),
  title: 'PG-1 Ticket',
  customer: parent.customer,
  performer: parent.performer,
  performerDepartmentId: parent.performerDepartmentId,
  milestoneId: null,
  parentLoopId: parent.id,
  ...overrides,
});
const withLoops = (...extra: Loop[]): GraphSnapshot => ({
  ...base,
  loops: [...base.loops, ...extra],
});
const messages = (snapshot: GraphSnapshot) => referenceErrors(snapshot).map((e) => e.message);

describe('ticket reference rules', () => {
  it('accepts a ticket of a top-level loop', () => {
    expect(referenceErrors(base)).toEqual([]);
    expect(referenceErrors(withLoops(ticket()))).toEqual([]);
  });
  it('rejects a missing parent', () => {
    const missing = randomUUID();
    expect(messages(withLoops(ticket({ parentLoopId: missing })))).toEqual([
      `parentLoopId references missing loops entity ${missing}; restore it or explicitly replace the reference.`,
    ]);
  });
  it('rejects a ticket that names itself', () => {
    const id = randomUUID();
    expect(messages(withLoops(ticket({ id, parentLoopId: id })))).toContain(
      'parentLoopId cannot name the loop itself.',
    );
  });
  it('rejects a ticket of a ticket', () => {
    const first = ticket();
    expect(messages(withLoops(first, ticket({ parentLoopId: first.id })))).toContain(
      `parentLoopId must name a top-level loop; ${first.id} is a ticket.`,
    );
  });
  it('rejects a ticket with a milestone', () => {
    expect(messages(withLoops(ticket({ milestoneId: parent.milestoneId })))).toContain(
      'A ticket takes no milestone; its parent loop carries the milestone.',
    );
  });
  it('rejects a milestone anchored on a ticket', () => {
    const t = ticket();
    const snapshot = withLoops(t);
    snapshot.context = {
      ...snapshot.context,
      milestones: snapshot.context.milestones.map((m, i) => (i === 0 ? { ...m, anchorLoopId: t.id } : m)),
    };
    expect(messages(snapshot)).toContain('anchorLoopId cannot name a ticket loop.');
  });
  it('keeps hashes and diffs of snapshots without the key', () => {
    const copy = JSON.parse(JSON.stringify(base)) as GraphSnapshot;
    expect(canonicalHash(copy)).toBe(canonicalHash(base));
    expect(diffSnapshots(base, copy).changes).toEqual([]);
    const moved = { ...copy, loops: copy.loops.map((l) => (l.id === base.loops[1].id ? { ...l, milestoneId: null, parentLoopId: parent.id } : l)) };
    expect(diffSnapshots(base, moved).changes.map((c) => [c.collection, c.kind])).toEqual([['loops', 'changed']]);
  });
  it('reports a conflict when a proposal adds a ticket and main removes the parent', () => {
    const lonely = base.loops.find(
      (loop) =>
        loop.id !== parent.id &&
        !base.acts.some((act) => act.loopId === loop.id) &&
        !base.context.milestones.some((m) => m.anchorLoopId === loop.id),
    );
    const target = lonely ?? parent;
    const candidate = withLoops(ticket({ parentLoopId: target.id }));
    const removedActs = new Set(
      base.acts.filter((act) => act.loopId === target.id).map((act) => act.id),
    );
    const removed: GraphSnapshot = {
      ...base,
      loops: base.loops.filter((loop) => loop.id !== target.id),
      acts: base.acts.filter((act) => !removedActs.has(act.id)),
      annotations: base.annotations.filter((note) => !note.actIds.some((id) => removedActs.has(id))),
      context: {
        ...base.context,
        milestones: base.context.milestones.map((m) =>
          m.anchorLoopId === target.id ? { ...m, anchorLoopId: null } : m,
        ),
      },
    };
    const result = threeWayRebase(base, candidate, removed);
    expect(result.conflicts.some((c) => c.collection === 'loops' && c.reason.includes('parentLoopId'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/graph/ticket-references.test.ts > /tmp/unit.log 2>&1; echo $?`
Expected: exit 1. TypeScript or the assertions fail on `parentLoopId`; the rule messages are missing.

- [ ] **Step 3: Add the field**

In `src/contracts/graph.ts`, change `LoopSchema` to:

```ts
export const LoopSchema = z.strictObject({
  id: IdSchema,
  title: z.string().min(1).max(200),
  customer: PartySchema,
  performer: PartySchema,
  performerDepartmentId: IdSchema,
  milestoneId: IdSchema.nullable(),
  /** Present only on a ticket. A top-level loop has no key at all: null or undefined would change hashes and diffs. */
  parentLoopId: IdSchema.optional(),
});
```

- [ ] **Step 4: Add the rules**

In `src/server/graph/references.ts`:

1. Replace `const loops = new Set(snapshot.loops.map((entity) => entity.id));` with:

```ts
  const loopById = new Map(snapshot.loops.map((entity) => [entity.id, entity]));
  const loops = new Set(loopById.keys());
```

2. Replace the milestone loop with:

```ts
  for (const milestone of snapshot.context.milestones) {
    reference('milestones', milestone.id, 'anchorLoopId', milestone.anchorLoopId, loops, 'loops');
    if (milestone.anchorLoopId && loopById.get(milestone.anchorLoopId)?.parentLoopId !== undefined)
      errors.push({
        collection: 'milestones',
        id: milestone.id,
        message: 'anchorLoopId cannot name a ticket loop.',
      });
  }
```

3. At the end of the body of `for (const loop of snapshot.loops)`, add:

```ts
    if (loop.parentLoopId !== undefined) {
      const ticketError = (message: string) =>
        errors.push({ collection: 'loops', id: loop.id, message });
      if (loop.parentLoopId === loop.id) ticketError('parentLoopId cannot name the loop itself.');
      else {
        reference('loops', loop.id, 'parentLoopId', loop.parentLoopId, loops, 'loops');
        if (loopById.get(loop.parentLoopId)?.parentLoopId !== undefined)
          ticketError(`parentLoopId must name a top-level loop; ${loop.parentLoopId} is a ticket.`);
      }
      if (loop.milestoneId !== null)
        ticketError('A ticket takes no milestone; its parent loop carries the milestone.');
    }
```

- [ ] **Step 5: Run the unit tests and see them pass**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/graph/ticket-references.test.ts > /tmp/unit.log 2>&1; echo $?`
Expected: exit 0, `Tests  8 passed (8)`. If the rebase test finds the conflict under another reason text, print `result.conflicts` and assert on the reason that names `parentLoopId`.

- [ ] **Step 6: Write the failing integration test**

Create `tests/integration/proposals/tickets.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { seedLarkspur, type LarkspurSeed } from '../../support/seed';
import { createProposal, updateProposal } from '../../../src/server/domain/proposals';
import type { ActorContext, Loop } from '../../../src/contracts';

describe.skipIf(!process.env.TEST_DATABASE_URL)('ticket proposals', () => {
  let t: TestDb, ctx: ActorContext, seed: LarkspurSeed, proposalId: string;
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await testActor(t.db);
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    seed = await seedLarkspur(t.db, ctx);
    proposalId = (
      await createProposal(t.db, ctx, {
        projectId: seed.projectId,
        baseCommitId: seed.seedCommitId,
        title: 'Tickets',
        expectedEvidenceRevision: seed.evidenceRevision,
        idempotencyKey: randomUUID(),
      })
    ).id;
  });
  const put = (value: Loop) =>
    updateProposal(t.db, ctx, {
      projectId: seed.projectId,
      proposalId,
      expectedProposalRevision: 0,
      expectedEvidenceRevision: seed.evidenceRevision,
      operations: [{ op: 'put', collection: 'loops', value }],
      idempotencyKey: randomUUID(),
    });
  const ticket = (overrides: Partial<Loop> = {}): Loop => {
    const parent = seed.snapshot.loops[0];
    return {
      id: randomUUID(),
      title: 'PG-9 Ticket',
      customer: parent.customer,
      performer: parent.performer,
      performerDepartmentId: parent.performerDepartmentId,
      milestoneId: null,
      parentLoopId: parent.id,
      ...overrides,
    };
  };

  it('accepts a ticket of a top-level loop', async () => {
    await expect(put(ticket())).resolves.toBeDefined();
  });
  it('rejects a ticket with a milestone', async () => {
    await expect(
      put(ticket({ milestoneId: seed.snapshot.context.milestones[0].id })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('rejects a ticket of a missing loop', async () => {
    await expect(put(ticket({ parentLoopId: randomUUID() }))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});
```

- [ ] **Step 7: Run it**

Run: `npx pnpm@11.25.0 exec vitest run tests/integration/proposals/tickets.test.ts > /tmp/int.log 2>&1; echo $?`
Expected: exit 0, `Tests  3 passed (3)`. If `seedLarkspur` returns other field names, read `tests/support/seed.ts` and use them; the assertions stay the same.

- [ ] **Step 8: Run all unit and integration tests**

Run: `npx pnpm@11.25.0 test > /tmp/test.log 2>&1; echo $?`
Expected: exit 0. The MCP tool-listing size test (`tests/integration/adapters/mcp.test.ts`, 50,000 characters) still passes.

- [ ] **Step 9: Commit**

```bash
npx pnpm@11.25.0 format
git add src/contracts/graph.ts src/server/graph/references.ts tests
git commit -m "feat: optional parent loop for tickets, with reference rules"
```

---

### Task 2: Editor and review keep the parent

**Files:**
- Create: `src/components/review/loop-value.ts`
- Modify: `src/components/review/LoopEditor.tsx`
- Modify: `src/components/review/ProposalWorkspace.tsx` (both `<LoopEditor` call sites)
- Modify: `src/components/review/describe.ts` (`fieldValue`, `FIELD_LABEL`)
- Test: `tests/unit/review/loop-value.test.ts` (new), `tests/unit/review/describe-ticket.test.ts` (new)

**Interfaces:**
- Consumes: `Loop.parentLoopId` (Task 1); `partyFromValue` from `src/components/review/operations.ts`.
- Produces:
  - `type LoopForm = { id: string; title: string; customer: string; performer: string; departmentId: string; milestoneId: string; parentId: string }`
  - `loopValue(form: LoopForm): Loop`
  - `LoopEditor` prop `loops: readonly Loop[]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/review/loop-value.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loopValue } from '../../../src/components/review/loop-value';

const form = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '  PG-118 Dynamics CRM sync job ',
  customer: 'side:vendor',
  performer: 'side:vendor',
  departmentId: '22222222-2222-4222-8222-222222222222',
  milestoneId: '33333333-3333-4333-8333-333333333333',
  parentId: '',
};

describe('loopValue', () => {
  it('writes no parentLoopId key for a top-level loop', () => {
    const value = loopValue(form);
    expect('parentLoopId' in value).toBe(false);
    expect(value).toMatchObject({ title: 'PG-118 Dynamics CRM sync job', milestoneId: form.milestoneId });
  });
  it('keeps the parent of a ticket and drops its milestone', () => {
    const parentId = '44444444-4444-4444-8444-444444444444';
    expect(loopValue({ ...form, parentId })).toMatchObject({ parentLoopId: parentId, milestoneId: null });
  });
});
```

Create `tests/unit/review/describe-ticket.test.ts`:

```ts
import { expect, it } from 'vitest';
import { fieldLines, type Names } from '../../../src/components/review/describe';

const names: Names = {
  people: {},
  loops: { P: 'Go-live date' },
  milestones: {},
  departments: {},
  records: {},
};

it('names the parent loop of a ticket by its title', () => {
  const before = { id: 'T', title: 'PG-1 Ticket', milestoneId: null };
  const after = { ...before, parentLoopId: 'P' };
  const [was, now] = fieldLines('loops', [before as never, after as never], names);
  expect(now).toEqual([{ field: 'parentLoopId', label: 'parent loop', value: 'Go-live date' }]);
  expect(was).toEqual([{ field: 'parentLoopId', label: 'parent loop', value: 'none' }]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/review > /tmp/unit.log 2>&1; echo $?`
Expected: exit 1. `loop-value` does not resolve; the describe label is `parentLoopId` and the value is the raw ID.

- [ ] **Step 3: Create the form helper**

Create `src/components/review/loop-value.ts`:

```ts
import type { Loop } from '../../contracts/graph';
import { partyFromValue } from './operations';

export type LoopForm = {
  id: string;
  title: string;
  customer: string;
  performer: string;
  departmentId: string;
  milestoneId: string;
  parentId: string;
};

/** A top-level loop gets no parentLoopId key: null or undefined would change hashes and diffs. */
export function loopValue(form: LoopForm): Loop {
  return {
    id: form.id,
    title: form.title.trim(),
    customer: partyFromValue(form.customer),
    performer: partyFromValue(form.performer),
    performerDepartmentId: form.departmentId,
    milestoneId: form.parentId ? null : form.milestoneId || null,
    ...(form.parentId ? { parentLoopId: form.parentId } : {}),
  };
}
```

- [ ] **Step 4: Use it in `LoopEditor`**

In `src/components/review/LoopEditor.tsx`:

1. Add `loops: readonly Loop[];` to `Props`, destructure `loops`, and import `loopValue` from `./loop-value`.
2. Add state and two values:

```ts
  const [parentId, setParentId] = useState(loop?.parentLoopId ?? '');
  const parents = loops.filter((item) => item.parentLoopId === undefined && item.id !== id);
  const hasTickets = loops.some((item) => item.parentLoopId === id);
```

3. In `submit`, replace the whole `value: { ... }` object with:

```ts
          value: loopValue({
            id,
            title,
            customer,
            performer,
            departmentId,
            milestoneId,
            parentId,
          }),
```

4. Next to the milestone select, add a select in the same markup style:

```tsx
        <label>
          Parent loop
          <select
            value={parentId}
            disabled={!editable || hasTickets}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">None</option>
            {parents.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
```

5. Add `|| Boolean(parentId)` to the milestone select's `disabled` condition.

In `src/components/review/ProposalWorkspace.tsx`, pass `loops={...}` to both `<LoopEditor` call sites with the loops of the candidate snapshot that the workspace already reads. Find the variable: `grep -n "snapshot\|candidate" src/components/review/ProposalWorkspace.tsx`.

- [ ] **Step 5: Label the field in the review**

In `src/components/review/describe.ts`:
- In `fieldValue`, change `if (field === 'loopId') return loopName(value as string, names);` to `if (field === 'loopId' || field === 'parentLoopId') return loopName(value as string, names);`.
- In `FIELD_LABEL`, add `parentLoopId: 'parent loop',`.

- [ ] **Step 6: Run the tests and see them pass**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/review > /tmp/unit.log 2>&1; echo $?`
Expected: exit 0. Run `npx pnpm@11.25.0 typecheck` too (exit 0), because the editor now needs `loops`.

- [ ] **Step 7: Commit**

```bash
npx pnpm@11.25.0 format
git add src/components/review tests/unit/review
git commit -m "feat: the loop editor keeps and edits a ticket's parent"
```

---

### Task 3: Ticket progress and ticket-aware filters

**Files:**
- Create: `src/lib/graph-layout/tickets.ts`
- Modify: `src/lib/graph-layout/index.ts` (re-export)
- Modify: `src/components/graph/filters.ts`
- Test: `tests/unit/graph/tickets.test.ts` (new)

**Interfaces:**
- Produces:
  - `type TicketProgress = { done: number; total: number; broken: boolean; warning: boolean }`
  - `ticketProgress(tickets: readonly DerivedLoop[]): TicketProgress`
  - `ticketsByParent(loops: readonly DerivedLoop[]): Map<string, DerivedLoop[]>` (tickets sorted by `firstActAt`, then ID)
  - `withTickets(engine: EngineOutput, visible: ReadonlySet<string>): Set<string>`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/graph/tickets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DerivedLoop, EngineOutput } from '../../../src/contracts';
import { ticketProgress, ticketsByParent } from '../../../src/lib/graph-layout';
import { withTickets } from '../../../src/components/graph/filters';

const loop = (
  id: string,
  state: DerivedLoop['state'],
  parentLoopId?: string,
  severity?: 'broken' | 'warning',
  firstActAt: string | null = '2026-10-01T00:00:00Z',
): DerivedLoop =>
  ({
    loop: { id, title: id, ...(parentLoopId ? { parentLoopId } : {}) },
    state,
    firstActAt,
    breakdowns: severity ? [{ severity }] : [],
  }) as unknown as DerivedLoop;

describe('ticketProgress', () => {
  it('counts delivered and closed as done and leaves declined and cancelled out of the total', () => {
    expect(
      ticketProgress([
        loop('a', 'closed', 'p'),
        loop('b', 'delivered', 'p'),
        loop('c', 'promised', 'p', 'broken'),
        loop('d', 'cancelled', 'p'),
        loop('e', 'requested', 'p', 'warning'),
      ]),
    ).toEqual({ done: 2, total: 4, broken: true, warning: false });
    expect(ticketProgress([loop('e', 'requested', 'p', 'warning')])).toEqual({
      done: 0,
      total: 1,
      broken: false,
      warning: true,
    });
  });
  it('groups tickets by parent in start order', () => {
    const grouped = ticketsByParent([
      loop('p', 'promised'),
      loop('late', 'promised', 'p', undefined, '2026-10-05T00:00:00Z'),
      loop('early', 'promised', 'p', undefined, '2026-10-02T00:00:00Z'),
    ]);
    expect(grouped.get('p')!.map((item) => item.loop.id)).toEqual(['early', 'late']);
    expect(grouped.has('late')).toBe(false);
  });
});

describe('withTickets', () => {
  const engine = {
    loops: [loop('p', 'promised'), loop('t1', 'promised', 'p'), loop('t2', 'closed', 'p'), loop('q', 'closed')],
  } as unknown as EngineOutput;
  it('keeps a parent when only a ticket matches, and brings all its tickets', () => {
    expect([...withTickets(engine, new Set(['t1']))].sort()).toEqual(['p', 't1', 't2']);
  });
  it('brings the tickets of a matching parent', () => {
    expect([...withTickets(engine, new Set(['p', 'q']))].sort()).toEqual(['p', 'q', 't1', 't2']);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/graph/tickets.test.ts > /tmp/unit.log 2>&1; echo $?`
Expected: exit 1, missing exports.

- [ ] **Step 3: Write the progress helper**

Create `src/lib/graph-layout/tickets.ts`:

```ts
import type { DerivedLoop, LoopState } from '../../contracts/engine';

export type TicketProgress = { done: number; total: number; broken: boolean; warning: boolean };
const DONE: ReadonlySet<LoopState> = new Set(['delivered', 'closed']);
const DROPPED: ReadonlySet<LoopState> = new Set(['declined', 'cancelled']);

export function ticketProgress(tickets: readonly DerivedLoop[]): TicketProgress {
  const counted = tickets.filter((ticket) => !ticket.state || !DROPPED.has(ticket.state));
  const broken = tickets.some((ticket) => ticket.breakdowns.some((b) => b.severity === 'broken'));
  return {
    done: counted.filter((ticket) => ticket.state && DONE.has(ticket.state)).length,
    total: counted.length,
    broken,
    warning: !broken && tickets.some((ticket) => ticket.breakdowns.length > 0),
  };
}

export function ticketsByParent(loops: readonly DerivedLoop[]): Map<string, DerivedLoop[]> {
  const grouped = new Map<string, DerivedLoop[]>();
  for (const loop of loops) {
    const parent = loop.loop.parentLoopId;
    if (parent !== undefined) grouped.set(parent, [...(grouped.get(parent) ?? []), loop]);
  }
  for (const list of grouped.values())
    list.sort(
      (a, b) =>
        (a.firstActAt ?? '').localeCompare(b.firstActAt ?? '') ||
        (a.loop.id < b.loop.id ? -1 : a.loop.id > b.loop.id ? 1 : 0),
    );
  return grouped;
}
```

In `src/lib/graph-layout/index.ts`, add `export { ticketProgress, ticketsByParent, type TicketProgress } from './tickets';`.

- [ ] **Step 4: Write the filter helper**

In `src/components/graph/filters.ts`, add after `applyFilters`:

```ts
/** A parent stays when one of its tickets matches, and brings all its tickets; the layout hides tickets of a collapsed parent. */
export function withTickets(engine: EngineOutput, visible: ReadonlySet<string>): Set<string> {
  const result = new Set(visible);
  for (const { loop } of engine.loops)
    if (loop.parentLoopId !== undefined && visible.has(loop.id)) result.add(loop.parentLoopId);
  for (const { loop } of engine.loops)
    if (loop.parentLoopId !== undefined && result.has(loop.parentLoopId)) result.add(loop.id);
  return result;
}
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/graph/tickets.test.ts > /tmp/unit.log 2>&1; echo $?`
Expected: exit 0, `Tests  4 passed (4)`.

- [ ] **Step 6: Commit**

```bash
npx pnpm@11.25.0 format
git add src/lib/graph-layout src/components/graph/filters.ts tests/unit/graph/tickets.test.ts
git commit -m "feat: ticket progress and ticket-aware filters"
```

---

### Task 4: Layout blocks for parents and tickets

**Files:**
- Modify: `src/contracts/layout.ts` (`LayoutOptionsSchema`, `BranchLayoutSchema`)
- Modify: `src/lib/graph-layout/index.ts` (`packRows`, drafts, branch building, navigation)
- Modify: `src/lib/graph-layout/offsets.ts`
- Test: `tests/unit/layout/tickets-layout.test.ts` (new), existing layout tests

**Interfaces:**
- Consumes: `ticketsByParent`, `ticketProgress` (Task 3); `branchPath`, `CURVE`, `applyLayoutOffsets` (declutter).
- Produces:
  - Option `expandedLoopIds: string[]` (default `[]`).
  - `BranchLayout.parentLoopId: string | null`, `BranchLayout.forkY: number`, `BranchLayout.tickets: (TicketProgress & { expanded: boolean }) | null`.
  - Exported constants `CHIP_WIDTH = 50`, `chipX(branch: BranchLayout): number`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/layout/tickets-layout.test.ts`. Build an engine from the fixture with five synthetic tickets, so the test does not depend on Task 7:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CHIP_WIDTH,
  applyLayoutOffsets,
  chipX,
  layoutPromiseGraph,
} from '../../../src/lib/graph-layout';
import { deriveProject } from '../../../src/server/loops/engine';
import main from '../../../fixtures/main-snapshot.json';
import records from '../../../fixtures/records.json';
import gold from '../../../fixtures/gold.json';
import { engineInputFromFixtures, uuidFromKey } from '../../../scripts/build-fixtures';
import type { GraphSnapshot } from '../../../src/contracts';
import { GraphLayoutSchema } from '../../../src/contracts/layout';

const snapshot = structuredClone(main) as GraphSnapshot;
const parentId = uuidFromKey('loop:go-live');
const parent = snapshot.loops.find((loop) => loop.id === parentId)!;
const ticketIds = Array.from({ length: 3 }, () => randomUUID());
const engineerDept = snapshot.context.departments.find((d) => d.name === 'Engineering')!.id;
for (const id of ticketIds)
  snapshot.loops.push({
    id,
    title: `PG ${id.slice(0, 4)}`,
    customer: parent.performer,
    performer: parent.performer,
    performerDepartmentId: engineerDept,
    milestoneId: null,
    parentLoopId: parentId,
  });
// Each ticket borrows two acts of the parent, so it has a time span inside the parent's span.
const parentActs = snapshot.acts.filter((act) => act.loopId === parentId);
ticketIds.forEach((id, index) =>
  snapshot.acts.push(
    ...parentActs.slice(0, 2).map((act) => ({ ...act, id: randomUUID(), loopId: id })),
  ),
);
const engine = deriveProject(
  engineInputFromFixtures(snapshot, records.filter((r) => r.projectKey === 'larkspur'), gold.T),
);
const layout = (expandedLoopIds: string[] = []) =>
  layoutPromiseGraph(engine, { context: snapshot.context }, { pxPerDay: 12, expandedLoopIds });

describe('ticket layout', () => {
  it('hides the tickets of a collapsed parent and shows its progress', () => {
    const l = layout();
    expect(l.branches.some((b) => ticketIds.includes(b.loopId))).toBe(false);
    const p = l.branches.find((b) => b.loopId === parentId)!;
    expect(p.tickets).toMatchObject({ total: 3, expanded: false });
    expect(p.parentLoopId).toBeNull();
    expect(p.forkY).toBe(l.trunkY);
    expect(GraphLayoutSchema.safeParse(l).success).toBe(true);
  });
  it('places expanded tickets in the next rows of the parent lane and forks them from the parent line', () => {
    const l = layout([parentId]);
    const p = l.branches.find((b) => b.loopId === parentId)!;
    const tickets = l.branches.filter((b) => b.parentLoopId === parentId);
    expect(tickets).toHaveLength(3);
    expect(tickets.map((t) => t.row)).toEqual([p.row + 1, p.row + 2, p.row + 3]);
    for (const t of tickets) {
      expect(t.departmentId).toBe(p.departmentId);
      expect(t.forkY).toBe(p.y);
      expect(t.title).toContain('· Engineering');
    }
    const order = l.navigation.loopIds;
    expect(order.slice(order.indexOf(parentId), order.indexOf(parentId) + 4)).toEqual([
      parentId,
      ...tickets.map((t) => t.loopId),
    ]);
    expect(GraphLayoutSchema.safeParse(l).success).toBe(true);
  });
  it('keeps the next branch in the parent row clear of the chip', () => {
    const l = layout();
    const p = l.branches.find((b) => b.loopId === parentId)!;
    const sameRow = l.branches
      .filter((b) => b.departmentId === p.departmentId && b.row === p.row && b.xStart > p.xStart)
      .sort((a, b) => a.xStart - b.xStart);
    if (sameRow[0]) expect(sameRow[0].xStart).toBeGreaterThanOrEqual(chipX(p) + CHIP_WIDTH);
  });
  it('moves the ticket forks when the parent is dragged', () => {
    const l = layout([parentId]);
    const moved = applyLayoutOffsets(l, { acts: {}, loops: { [parentId]: -6 } }, 28);
    const p = moved.branches.find((b) => b.loopId === parentId)!;
    for (const t of moved.branches.filter((b) => b.parentLoopId === parentId)) {
      expect(t.forkY).toBe(p.y);
      expect(t.path).toContain(` ${p.y} `);
    }
  });
  it('hides a ticket whose parent is not in the input', () => {
    const l = layoutPromiseGraph(
      { ...engine, loops: engine.loops.filter((loop) => loop.loop.id !== parentId) },
      { context: snapshot.context },
      { pxPerDay: 12, expandedLoopIds: [parentId] },
    );
    expect(l.branches.some((b) => ticketIds.includes(b.loopId))).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/layout/tickets-layout.test.ts > /tmp/unit.log 2>&1; echo $?`
Expected: exit 1, missing `CHIP_WIDTH`, `chipX` and the new branch fields.

- [ ] **Step 3: Extend the contract**

In `src/contracts/layout.ts`:

- In `LayoutOptionsSchema`, add `expandedLoopIds: z.array(IdSchema).default([]),`.
- In `BranchLayoutSchema`, add:

```ts
  parentLoopId: IdSchema.nullable(),
  forkY: coordinate,
  tickets: z
    .strictObject({
      done: RevisionSchema,
      total: RevisionSchema,
      broken: z.boolean(),
      warning: z.boolean(),
      expanded: z.boolean(),
    })
    .nullable(),
```

- [ ] **Step 4: Pack blocks and build ticket branches**

In `src/lib/graph-layout/index.ts`:

1. Add `import { ticketProgress, ticketsByParent } from './tickets';` and, below the imports:

```ts
export const CHIP_WIDTH = 50;
const CHIP_GAP = 8;
/** Left edge of a parent's progress chip; past the merge curve when the parent merges into the trunk. */
export const chipX = (branch: Pick<BranchLayout, 'xEnd' | 'endKind'>) =>
  branch.xEnd + (branch.endKind === 'merge' ? CURVE + 4 : CHIP_GAP);
```

2. Replace `packRows` with a block packer:

```ts
interface Block {
  department: Department;
  xStart: number;
  xEnd: number;
  size: number;
  row: number;
}
function packRows(blocks: Block[], branchGap: number): Map<string, number> {
  const rowEnds = new Map<string, number[]>();
  for (const block of blocks) {
    const ends = rowEnds.get(block.department.id) ?? [];
    const free = (row: number) => ends[row] === undefined || block.xStart - ends[row] >= branchGap;
    let row = 0;
    while (!Array.from({ length: block.size }, (_, i) => free(row + i)).every(Boolean)) row++;
    for (let i = 0; i < block.size; i++) ends[row + i] = block.xEnd;
    block.row = row;
    rowEnds.set(block.department.id, ends);
  }
  return new Map([...rowEnds].map(([id, ends]) => [id, ends.length]));
}
```

3. In `layoutPromiseGraph`, read `expandedLoopIds` from `LayoutOptionsSchema.parse(options)`. Then replace everything from `const drafts: Draft[] = [];` through `const subRows = packRows(drafts, branchGap);` with:

```ts
  const grouped = ticketsByParent(engine.loops);
  const expanded = new Set(expandedLoopIds);
  const draftOf = (loop: DerivedLoop, department: Department): Draft => {
    // A loop with no acts at or before T still counts in the engine, so it stays visible as a point at T.
    const startAt = loop.acts[0]?.occurredAt ?? engine.T;
    const xStart = round(scale.x(startAt)),
      end = endOf(loop, engine.T);
    const lineEnd = Math.max(xStart, end.kind === 'open' ? xT : round(scale.x(end.at)));
    const tailEnd =
      end.kind === 'open' && loop.dueSoon && loop.dueAt
        ? Math.max(lineEnd, round(scale.x(loop.dueAt)))
        : lineEnd;
    return {
      loop,
      department,
      startEpoch: Date.parse(startAt),
      xStart,
      lineEnd,
      xEnd: tailEnd,
      endKind: end.kind,
      row: 0,
    };
  };
  const byStart = (a: Draft, b: Draft) =>
    a.startEpoch - b.startEpoch || compareId(a.loop.loop.id, b.loop.loop.id);
  const blocks: (Block & { parent: Draft; tickets: Draft[] })[] = [];
  for (const loop of engine.loops) {
    if (loop.loop.parentLoopId !== undefined) continue;
    const department = departments.get(loop.loop.performerDepartmentId);
    // A loop without a lane fails reference validation elsewhere.
    if (!department) continue;
    const parent = draftOf(loop, department);
    // A ticket sits in its parent's lane, and only while the parent is expanded.
    const tickets = expanded.has(loop.loop.id)
      ? (grouped.get(loop.loop.id) ?? []).map((ticket) => draftOf(ticket, department)).sort(byStart)
      : [];
    const parentEnd = grouped.has(loop.loop.id) ? chipX(parent) + CHIP_WIDTH : parent.xEnd;
    blocks.push({
      parent,
      tickets,
      department,
      xStart: Math.min(parent.xStart, ...tickets.map((ticket) => ticket.xStart - CURVE)),
      xEnd: Math.max(parentEnd, ...tickets.map((ticket) => ticket.xEnd + CURVE)),
      size: 1 + tickets.length,
      row: 0,
    });
  }
  blocks.sort((a, b) => byStart(a.parent, b.parent));
  const subRows = packRows(blocks, branchGap);
```

4. Turn the branch builder into a function. Replace the header

```ts
  const branches: BranchLayout[] = drafts.map(
    ({ loop, department, xStart, lineEnd, xEnd, endKind, row }) => {
      const y = round(rowY(department.id, row));
```

with

```ts
  const branchOf = (
    { loop, department, xStart, lineEnd, xEnd, endKind }: Draft,
    row: number,
    y: number,
    forkY: number,
    parentLoopId: string | null,
  ): BranchLayout => {
```

and the matching closing `},\n  );` of that `drafts.map` with `};`. Inside the function body:
   - Delete the `fork` and `merge` constants (the declutter work already replaced them with `branchPath`) and set `path: branchPath(xStart, xEnd, y, forkY, endKind === 'merge'),`.
   - Add these lines before `return {`:

```ts
      const own = departments.get(loop.loop.performerDepartmentId) ?? department;
      const title =
        own.id === department.id ? loop.loop.title : `${loop.loop.title} · ${own.name}`;
```

   - In the returned object, use `title,`, `accessibleName: \`Loop: ${loop.loop.title}, ${own.name}, ${status}\`,` and add `parentLoopId,`, `forkY,` and `tickets: null,`.

5. After `branchOf`, build the branches in block order:

```ts
  const branches: BranchLayout[] = blocks.flatMap((block) => {
    const id = block.parent.loop.loop.id;
    const y = round(rowY(block.department.id, block.row));
    const parent: BranchLayout = {
      ...branchOf(block.parent, block.row, y, trunkY, null),
      tickets: grouped.has(id)
        ? { ...ticketProgress(grouped.get(id)!), expanded: expanded.has(id) }
        : null,
    };
    return [
      parent,
      ...block.tickets.map((ticket, index) => {
        const row = block.row + 1 + index;
        return branchOf(ticket, row, round(rowY(block.department.id, row)), y, id);
      }),
    ];
  });
```

`navigation.loopIds` already maps `branches`, so it follows the block order: parent, then its tickets. Remove the `row` field from `Draft` only if `tsc` reports it unused.

- [ ] **Step 5: Let ticket forks follow the parent**

In `src/lib/graph-layout/offsets.ts`:
- In the branch map, rebuild the path with `branch.forkY` instead of `layout.trunkY`.
- After the map, add a second pass:

```ts
  const yOf = new Map(branches.map((branch) => [branch.loopId, branch.y]));
  const linked = branches.map((branch) => {
    if (branch.parentLoopId === null) return branch;
    const forkY = yOf.get(branch.parentLoopId) ?? branch.forkY;
    if (forkY === branch.forkY) return branch;
    changed = true;
    return {
      ...branch,
      forkY,
      path: branchPath(branch.xStart, branch.xEnd, branch.y, forkY, branch.endKind === 'merge'),
    };
  });
  return changed ? { ...layout, branches: linked } : layout;
```

In `src/components/graph/PromiseGraph.tsx`, in the declutter `zoomToLoop`, change both `layout.trunkY` in the box to `branch.forkY`, so a ticket's box reaches its parent's line.

- [ ] **Step 6: Run the layout tests**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/layout > /tmp/unit.log 2>&1; echo $?`
Expected: exit 0. The new tests pass, and the older layout and offset tests still pass (no fixture loop has tickets yet, so every block has size 1).

- [ ] **Step 7: Commit**

```bash
npx pnpm@11.25.0 format
git add src/contracts/layout.ts src/lib/graph-layout tests/unit/layout
git commit -m "feat: layout packs a parent and its expanded tickets as one block"
```

---

### Task 5: Progress chip and expand state on the graph

**Files:**
- Modify: `src/components/graph/ui-context.ts`, `BranchEdge.tsx`, `PromiseGraph.tsx`, `GraphScreen.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/e2e/graph.spec.ts`

**Interfaces:**
- Consumes: `BranchLayout.tickets`, `chipX`, `CHIP_WIDTH` (Task 4); `withTickets` (Task 3).
- Produces: `GraphUi.toggleTickets(loopId: string): void`; `PromiseGraphProps.onToggleTickets(loopId: string): void`; in `GraphScreen`, `expanded: ReadonlySet<string>` and `toggleTickets(loopId: string)` (Task 6 passes them to the panel).

- [ ] **Step 1: Write the failing e2e test** (append to `tests/e2e/graph.spec.ts`; it passes only after Task 7 seeds the tickets, so add it with `test.fixme` and remove the mark in Task 7 Step 9)

```ts
test.fixme('the go-live chip shows ticket progress and expands the tickets', async ({ page }) => {
  await signIn(page);
  const chip = page.getByRole('button', { name: /^Show 5 tickets, 3 done$/ });
  await expect(chip).toBeAttached();
  await expect(chip.locator('circle')).toHaveAttribute('fill', 'var(--danger)');
  const before = await branches(page).count();
  await chip.dispatchEvent('click');
  await expect(page.getByRole('button', { name: /^Hide 5 tickets, 3 done$/ })).toBeAttached();
  await expect.poll(() => branches(page).count()).toBe(before + 5);
  await expect(page.getByRole('button', { name: /^Loop: PG-121 Go-live checklist automation/ })).toBeAttached();
  await page.getByRole('button', { name: /^Hide 5 tickets, 3 done$/ }).dispatchEvent('click');
  await expect.poll(() => branches(page).count()).toBe(before);
  await expect(loopPanel(page)).toBeHidden();
});

test.fixme('a search that matches only a ticket keeps its parent on the graph', async ({ page }) => {
  await signIn(page);
  await page.getByRole('searchbox', { name: /search loop titles and quotes/i }).fill('PG-118');
  await expect(page.getByRole('button', { name: /^Loop: Go-live date/ })).toBeAttached();
  await expect(page.getByText(/5 tickets/)).toBeVisible();
});
```

- [ ] **Step 2: Add the UI callback**

In `src/components/graph/ui-context.ts`, add to `GraphUi`: `toggleTickets(loopId: string): void;`.

In `src/components/graph/PromiseGraph.tsx`, add `onToggleTickets(loopId: string): void;` to `PromiseGraphProps`, destructure it in `Graph`, add `toggleTickets: onToggleTickets,` to the `ui` memo object and `onToggleTickets` to its dependencies.

- [ ] **Step 3: Draw the chip**

In `src/components/graph/BranchEdge.tsx`, add `import { CHIP_WIDTH, chipX } from '../../lib/graph-layout';` and, after the labels group from the declutter work, add:

```tsx
      {branch.tickets && (
        <g
          className="tk-chip nopan"
          role="button"
          tabIndex={-1}
          aria-expanded={branch.tickets.expanded}
          aria-label={`${branch.tickets.expanded ? 'Hide' : 'Show'} ${branch.tickets.total} tickets, ${branch.tickets.done} done`}
          transform={`translate(${chipX(branch)} ${y - 8})`}
          onClick={(event) => {
            event.stopPropagation();
            ui.toggleTickets(branch.loopId);
          }}
        >
          <rect width={CHIP_WIDTH} height={16} rx={8} />
          <text x={9} y={12} fontSize="10" fontWeight="700">
            {branch.tickets.expanded ? '▾' : '▸'} {branch.tickets.done}/{branch.tickets.total}
          </text>
          {(branch.tickets.broken || branch.tickets.warning) && (
            <circle
              cx={CHIP_WIDTH - 6}
              cy={2}
              r={3.5}
              fill={branch.tickets.broken ? 'var(--danger)' : 'var(--caution)'}
            />
          )}
        </g>
      )}
```

The chip has `tabIndex={-1}`: Tab keeps its order (milestones, then branches), and the loop panel gives keyboard users the same toggle.

- [ ] **Step 4: Own the expand state in `GraphScreen`**

In `src/components/graph/GraphScreen.tsx`:

1. Import `withTickets` from `./filters`.
2. Add state and the toggle:

```ts
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleTickets = useCallback(
    (id: string) =>
      setExpanded((previous) => {
        const next = new Set(previous);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
```

3. Wrap the filter result: `() => withTickets(engine, applyFilters(engine, filters, context.departments))`.
4. Pass `expandedLoopIds: [...expanded]` in the `baseLayout` options and add `expanded` to that memo's dependencies.
5. In the coverage `counts` memo, count only `visibleLoops.filter((loop) => loop.loop.parentLoopId === undefined)` for the existing numbers, and add `tickets` (all visible tickets) and `ticketsOpen` (visible tickets whose state is not `delivered`, `closed`, `declined` or `cancelled`). In the coverage line, after `{counts.ended} declined or cancelled`, add:

```tsx
          {counts.tickets > 0 && (
            <>
              {' '}
              · {counts.tickets} {counts.tickets === 1 ? 'ticket' : 'tickets'}, {counts.ticketsOpen} open
            </>
          )}
```

and make the `{visibleLoops.length} loops` text use the top-level count.
6. Pass `onToggleTickets={toggleTickets}` to `<PromiseGraph`.

- [ ] **Step 5: Style the chip** (in `src/app/globals.css`, after the `.src-label` rules)

```css
  .tk-chip {
    cursor: pointer;
  }
  .tk-chip rect {
    fill: var(--surface);
    stroke: var(--rule);
  }
  .tk-chip:hover rect {
    stroke: var(--ink);
  }
  .tk-chip text {
    fill: var(--ink);
  }
```

- [ ] **Step 6: Run the graph e2e tests**

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 0. The two new tests report as `fixme` (skipped); every older test passes.

- [ ] **Step 7: Commit**

```bash
npx pnpm@11.25.0 format
git add src/components/graph src/app/globals.css tests/e2e/graph.spec.ts
git commit -m "feat: ticket progress chip expands tickets under their parent"
```

---

### Task 6: Loop panel tickets section and list view rows

**Files:**
- Modify: `src/components/graph/LoopPanel.tsx`, `LoopList.tsx`, `GraphScreen.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/e2e/graph.spec.ts`

**Interfaces:**
- Consumes: `ticketsByParent`, `ticketProgress` (Task 3); `expanded`, `toggleTickets` (Task 5); `actSource`, `SourceIcon` (declutter); `GraphScreenProps.sources` (declutter).
- Produces: `LoopPanel` props `tickets: readonly DerivedLoop[]`, `parent: { id: string; title: string } | null`, `ticketsShown: boolean`, `onToggleTickets(): void`, `onOpenLoop(id: string): void`, `sources: Record<string, GraphSource>`.

- [ ] **Step 1: Write the failing e2e tests** (append with `test.fixme`; Task 7 Step 9 removes the marks)

```ts
test.fixme('the go-live panel lists its tickets with Linear links and opens a ticket', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: /^Loop: Go-live date/ }).click();
  const panel = loopPanel(page);
  const section = panel.getByRole('region', { name: /^Tickets/ });
  await expect(section).toContainText('Tickets (3/5 done)');
  await expect(section.getByRole('img', { name: 'Linear' })).toHaveCount(5);
  await expect(section.getByRole('link', { name: 'Open in Linear' }).first()).toHaveAttribute(
    'href',
    /^https:\/\/linear\.app\/fundline\/issue\/PG-/,
  );
  await section.getByRole('button', { name: 'Show tickets on graph' }).click();
  await expect(page.getByRole('button', { name: /^Hide 5 tickets/ })).toBeAttached();
  await section.getByRole('button', { name: /PG-121 Go-live checklist automation/ }).click();
  await expect(panel.getByText('Part of')).toBeVisible();
  await panel.getByRole('button', { name: 'Go-live date' }).click();
  await expect(panel.getByRole('heading', { name: 'Go-live date' })).toBeVisible();
});

test.fixme('the list view shows tickets indented under their parent', async ({ page }) => {
  await signIn(page);
  await page.getByRole('group', { name: /^view$/i }).getByRole('button', { name: 'List' }).click();
  const rows = page.getByRole('table', { name: /loops/i }).locator('tbody tr');
  const titles = (await rows.locator('td:first-child').allInnerTexts()).map((t) => t.trim());
  const at = titles.indexOf('Go-live date');
  expect(titles.slice(at + 1, at + 6).every((t) => t.startsWith('↳ PG-'))).toBe(true);
  await expect(rows.filter({ hasText: 'PG-121' })).toHaveAttribute('data-ticket', 'true');
});
```

Also change the existing test `list view shows the same loops as the graph with the same filters`: the list always shows tickets, the graph hides them while collapsed. Replace both `page.getByRole('table', { name: /loops/i }).locator('tbody tr')` locators in that test with `page.getByRole('table', { name: /loops/i }).locator('tbody tr:not([data-ticket])')`.

- [ ] **Step 2: Add the tickets section to `LoopPanel`**

In `src/components/graph/LoopPanel.tsx`:

1. Add the props from the Interfaces block and import `ticketProgress` from `../../lib/graph-layout`, `actSource` from `./source-link`, `SourceIcon` from `./SourceIcon`.
2. Right after the `<h2>` title block, when `parent` is set, add:

```tsx
          {parent && (
            <p className="faint" style={{ margin: '0 0 6px' }}>
              Part of{' '}
              <button type="button" className="linkish" onClick={() => onOpenLoop(parent.id)}>
                {parent.title}
              </button>
            </p>
          )}
```

3. Before the "Steps" `<h3>`, when `tickets.length > 0`, add:

```tsx
          {tickets.length > 0 && (
            <section aria-label={`Tickets (${progress.done}/${progress.total} done)`}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <h3 style={{ margin: 0 }}>
                  Tickets ({progress.done}/{progress.total} done)
                </h3>
                <button type="button" className="btn" onClick={onToggleTickets}>
                  {ticketsShown ? 'Hide tickets on graph' : 'Show tickets on graph'}
                </button>
              </div>
              <ul className="tickets">
                {tickets.map((ticket) => {
                  const last = ticket.acts.at(-1);
                  const source = last
                    ? actSource(
                        projectId,
                        last.citation.recordVersionId,
                        sources[last.citation.recordVersionId],
                      )
                    : null;
                  return (
                    <li key={ticket.loop.id}>
                      {source?.app && <SourceIcon app={source.app} size={14} />}
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenLoop(ticket.loop.id)}
                      >
                        {ticket.loop.title}
                      </button>
                      <span className="faint">
                        {stateLabel(ticket.state)} ·{' '}
                        {directory.departments.get(ticket.loop.performerDepartmentId)?.name ??
                          'Unknown'}
                      </span>
                      {source?.link.external && (
                        <a href={source.link.href} target="_blank" rel="noopener noreferrer">
                          {source.link.text}
                          <span aria-hidden="true"> ↗</span>
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
```

with `const progress = ticketProgress(tickets);` near the top of the component.

- [ ] **Step 3: Pass the props from `GraphScreen`**

In `src/components/graph/GraphScreen.tsx`:

```ts
  const grouped = useMemo(() => ticketsByParent(engine.loops), [engine]);
```

and on `<LoopPanel`:

```tsx
                tickets={grouped.get(selectedLoop.loop.id) ?? []}
                parent={
                  selectedLoop.loop.parentLoopId
                    ? (loopTargets.find((item) => item.id === selectedLoop.loop.parentLoopId) ?? null)
                    : null
                }
                ticketsShown={expanded.has(selectedLoop.loop.id)}
                onToggleTickets={() => toggleTickets(selectedLoop.loop.id)}
                onOpenLoop={selectLoop}
                sources={sources}
```

- [ ] **Step 4: Indent ticket rows in `LoopList`**

In `src/components/graph/LoopList.tsx`, order rows as parent, then its tickets:

```ts
  const ids = new Set(loops.map((loop) => loop.loop.id));
  const ordered = loops
    .filter((loop) => loop.loop.parentLoopId === undefined || !ids.has(loop.loop.parentLoopId))
    .flatMap((loop) => [
      loop,
      ...loops.filter((ticket) => ticket.loop.parentLoopId === loop.loop.id),
    ]);
```

Map over `ordered`. On a ticket row set `data-ticket="true"` on the `<tr>` and add `className="child"` to the first `<td>`; inside the title button prefix `↳ ` for tickets.

- [ ] **Step 5: Styles** (in `src/app/globals.css`)

```css
  .tickets {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
  }
  .tickets li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    padding: 6px 0;
    border-top: 1px solid var(--rule);
    font-size: 13px;
  }
  .tickets .src-icon {
    color: var(--ink-2);
  }
  .linkish {
    all: unset;
    cursor: pointer;
    font-weight: 700;
    color: var(--route);
  }
  .linkish:focus-visible {
    outline: 2px solid var(--focus);
  }
  td.child {
    padding-left: 28px;
  }
```

- [ ] **Step 6: Run the graph e2e tests**

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 0 (new tests skipped as `fixme`; the changed list test passes).

- [ ] **Step 7: Commit**

```bash
npx pnpm@11.25.0 format
git add src/components/graph src/app/globals.css tests/e2e/graph.spec.ts
git commit -m "feat: tickets in the loop panel and the list view"
```

---

### Task 7: Demo tickets and real-domain permalinks

**Files:**
- Modify: `scripts/build-fixtures.ts` (story types near line 43, loop build near line 395, channel rules near line 435)
- Modify: `fixtures/story-source.json`, then regenerate `fixtures/*.json`
- Modify: `fixtures/README.md`
- Modify tests that state 30 loops: `tests/unit/fixtures/fixtures.test.ts:30`, `tests/unit/graph/filters.test.ts:59,72,73,101`, `tests/integration/graph/read.test.ts:168,235-241`
- Test: `npx pnpm@11.25.0 eval`, `tests/integration/seed/seed.test.ts`

**Interfaces:**
- Consumes: Task 1 contract.
- Produces: loop keys `pg-112`, `pg-113`, `pg-117`, `pg-118`, `pg-121` (IDs `uuidFromKey('loop:pg-…')`).

- [ ] **Step 1: Let story loops name a parent**

In `scripts/build-fixtures.ts`:

1. In `interface StoryLoop`, change `milestone: string;` to `milestone?: string;` and add `parent?: string;`.
2. Before `const loops: Loop[] = story.map(...)`, add a check:

```ts
  for (const loop of story) {
    if (Boolean(loop.parent) === Boolean(loop.milestone))
      fail(`Story loop ${loop.key} needs exactly one of milestone or parent`);
    if (loop.parent && story.find((item) => item.key === loop.parent)?.parent !== undefined)
      fail(`Story loop ${loop.key} names a parent that is not a top-level loop`);
    if (loop.parent && !story.some((item) => item.key === loop.parent))
      fail(`Story loop ${loop.key} names an unknown parent ${loop.parent}`);
  }
```

3. In the returned loop object, replace `milestoneId: milestoneOf(loop.milestone),` with:

```ts
      milestoneId: loop.parent ? null : milestoneOf(loop.milestone!),
      ...(loop.parent ? { parentLoopId: id(`loop:${loop.parent}`) } : {}),
```

- [ ] **Step 2: Add the Linear channel and the Gmail permalinks**

In the channel rules:

1. Add a branch before the final `else`:

```ts
    } else if (kind === 'linear') {
      externalId = `linear:${channelName}:${String(sequence).padStart(3, '0')}`;
      threadExternalId = `linear:${channelName}`;
      const issueSlug = slug(draft.title.replace(/^[A-Z]+-\d+\s+/, ''));
      permalink = `https://linear.app/fundline/issue/${channelName}/${issueSlug}`;
```

2. In the final `else` (Gmail), after `lastInThread.set(...)`, add:

```ts
      if (kind === 'gmail') permalink = `https://mail.google.com/mail/u/0/#all/${externalId.replaceAll(':', '-')}`;
```

3. Linear records have no recipients: change `kind === 'slack' || kind === 'notion'` to `kind === 'slack' || kind === 'notion' || kind === 'linear'`.
4. For `kind === 'linear'`, set both `sourceLabel` fields (in the record and in the fixture record) to `draft.title` instead of `draft.channel`.

- [ ] **Step 3: Add the five tickets to the story**

In `fixtures/story-source.json`, append to `story` (after `close`):

```json
{
  "key": "pg-112", "title": "PG-112 Fund III data import", "customer": "Minh Trần", "performer": "Quang Nguyễn",
  "action": "import the Fund III data", "parent": "go-live",
  "expect": { "state": "closed", "breakdowns": [] },
  "events": [
    { "date": "2026-09-12", "person": "Minh Trần", "kind": "request", "quote": "Created and assigned to Quang Nguyễn.", "due": null, "hedged": false, "channel": "linear:PG-112", "before": "Issue PG-112 Fund III data import.", "after": "Priority: High." },
    { "date": "2026-09-13", "person": "Quang Nguyễn", "kind": "promise", "quote": "State: Todo → In Progress. Due date: 2026-09-26.", "due": "2026-09-26", "hedged": false, "channel": "linear:PG-112", "before": "Issue PG-112 Fund III data import.", "after": "Estimate: 3 points." },
    { "date": "2026-09-24", "person": "Quang Nguyễn", "kind": "report_done", "quote": "State: In Progress → In Review.", "due": null, "hedged": false, "channel": "linear:PG-112", "before": "Issue PG-112 Fund III data import.", "after": "Linked pull request merged." },
    { "date": "2026-09-25", "person": "Minh Trần", "kind": "accept", "quote": "State: In Review → Done.", "due": null, "hedged": false, "channel": "linear:PG-112", "before": "Issue PG-112 Fund III data import.", "after": "Checked against the Larkspur file." }
  ]
},
{
  "key": "pg-113", "title": "PG-113 Investor portal branding", "customer": "Minh Trần", "performer": "Lan Phạm",
  "action": "brand the investor portal", "parent": "go-live",
  "expect": { "state": "closed", "breakdowns": [] },
  "events": [
    { "date": "2026-09-13", "person": "Minh Trần", "kind": "request", "quote": "Created and assigned to Lan Phạm.", "due": null, "hedged": false, "channel": "linear:PG-113", "before": "Issue PG-113 Investor portal branding.", "after": "Priority: Medium." },
    { "date": "2026-09-14", "person": "Lan Phạm", "kind": "promise", "quote": "State: Todo → In Progress. Due date: 2026-09-22.", "due": "2026-09-22", "hedged": false, "channel": "linear:PG-113", "before": "Issue PG-113 Investor portal branding.", "after": "Estimate: 2 points." },
    { "date": "2026-09-20", "person": "Lan Phạm", "kind": "report_done", "quote": "State: In Progress → In Review.", "due": null, "hedged": false, "channel": "linear:PG-113", "before": "Issue PG-113 Investor portal branding.", "after": "Screenshots attached." },
    { "date": "2026-09-21", "person": "Minh Trần", "kind": "accept", "quote": "State: In Review → Done.", "due": null, "hedged": false, "channel": "linear:PG-113", "before": "Issue PG-113 Investor portal branding.", "after": "Matches the Larkspur brand guide." }
  ]
},
{
  "key": "pg-117", "title": "PG-117 Capital call notice template", "customer": "Minh Trần", "performer": "Lan Phạm",
  "action": "build the capital call notice template", "parent": "go-live",
  "expect": { "state": "closed", "breakdowns": [] },
  "events": [
    { "date": "2026-09-18", "person": "Minh Trần", "kind": "request", "quote": "Created and assigned to Lan Phạm.", "due": null, "hedged": false, "channel": "linear:PG-117", "before": "Issue PG-117 Capital call notice template.", "after": "Priority: High." },
    { "date": "2026-09-19", "person": "Lan Phạm", "kind": "promise", "quote": "State: Todo → In Progress. Due date: 2026-09-30.", "due": "2026-09-30", "hedged": false, "channel": "linear:PG-117", "before": "Issue PG-117 Capital call notice template.", "after": "Estimate: 3 points." },
    { "date": "2026-09-28", "person": "Lan Phạm", "kind": "report_done", "quote": "State: In Progress → In Review.", "due": null, "hedged": false, "channel": "linear:PG-117", "before": "Issue PG-117 Capital call notice template.", "after": "Sample notice attached." },
    { "date": "2026-09-29", "person": "Minh Trần", "kind": "accept", "quote": "State: In Review → Done.", "due": null, "hedged": false, "channel": "linear:PG-117", "before": "Issue PG-117 Capital call notice template.", "after": "Ready for the first close." }
  ]
},
{
  "key": "pg-118", "title": "PG-118 Dynamics CRM sync job", "customer": "Minh Trần", "performer": "Quang Nguyễn",
  "action": "ship the Dynamics CRM sync job", "parent": "go-live",
  "expect": { "state": "promised", "breakdowns": [] },
  "events": [
    { "date": "2026-09-25", "person": "Minh Trần", "kind": "request", "quote": "Created and assigned to Quang Nguyễn.", "due": null, "hedged": false, "channel": "linear:PG-118", "before": "Issue PG-118 Dynamics CRM sync job.", "after": "Priority: High." },
    { "date": "2026-09-26", "person": "Quang Nguyễn", "kind": "promise", "quote": "State: Todo → In Progress. Due date: 2026-10-13.", "due": "2026-10-13", "hedged": false, "channel": "linear:PG-118", "before": "Issue PG-118 Dynamics CRM sync job.", "after": "Estimate: 5 points." }
  ]
},
{
  "key": "pg-121", "title": "PG-121 Go-live checklist automation", "customer": "Minh Trần", "performer": "Quang Nguyễn",
  "action": "automate the go-live checklist", "parent": "go-live",
  "expect": { "state": "promised", "breakdowns": ["silent_overdue"] },
  "events": [
    { "date": "2026-09-30", "person": "Minh Trần", "kind": "request", "quote": "Created and assigned to Quang Nguyễn.", "due": null, "hedged": false, "channel": "linear:PG-121", "before": "Issue PG-121 Go-live checklist automation.", "after": "Priority: Urgent." },
    { "date": "2026-10-01", "person": "Quang Nguyễn", "kind": "promise", "quote": "State: Todo → In Progress. Due date: 2026-10-07.", "due": "2026-10-07", "hedged": false, "channel": "linear:PG-121", "before": "Issue PG-121 Go-live checklist automation.", "after": "Estimate: 2 points." }
  ]
}
```

- [ ] **Step 4: Regenerate the fixtures**

Run: `node --experimental-strip-types scripts/build-fixtures.ts > /tmp/build.log 2>&1; echo $?`
Expected: exit 0. If the builder fails with "Quote not found", the quote text must appear exactly in `before quote after`; fix the story.

Count the new totals for the README: `node -e "const m=require('./fixtures/main-snapshot.json'),r=require('./fixtures/records.json');console.log(m.loops.length,m.acts.length,r.filter(x=>x.projectKey==='larkspur').length,m.recordDecisions.filter(d=>d.disposition==='included').length)"`.
Expected: `35 130 137 130`. Use the printed numbers in Step 6.

- [ ] **Step 5: Update the count tests**

- `tests/unit/fixtures/fixtures.test.ts:30`: `toHaveLength(35)`.
- `tests/unit/graph/filters.test.ts`: the test name says "all 35 loops"; lines 72, 73 and 101 expect 35.
- `tests/integration/graph/read.test.ts:168`: 35.
- `tests/integration/graph/read.test.ts:235-241`: add `uuidFromKey('loop:pg-118')` and `uuidFromKey('loop:pg-121')` to the promised set.

- [ ] **Step 6: Update the fixture README**

In `fixtures/README.md`: change "30 loops" to "35 loops" (two places), "121 Larkspur records" and "114 acts, 114 included" to the Step 4 numbers, add a row to the "Story loops at T" table for each ticket, and add a section:

```markdown
## Tickets

Five Linear tickets are child loops of `go-live` (`parent` in `story-source.json`). They take no milestone. Their records use the channel `linear:<KEY>`, the source label `<KEY> <title>` and a permalink on `linear.app/fundline`. Gmail records get a `mail.google.com` permalink and Slack records a `fundline-larkspur.slack.com` permalink, so the demo shows app icons and links. The workspaces are fictional; a link opens the real app's sign-in or "not found" page.
```

Change "The engine matched the hand-written gold for all 30 loops" to "all 35 loops" only after Step 7 passes.

- [ ] **Step 7: Run the eval and all tests**

Run: `npx pnpm@11.25.0 eval > /tmp/eval.log 2>&1; echo $?` — expected exit 0, every metric at 100 %.
Run: `npx pnpm@11.25.0 test > /tmp/test.log 2>&1; echo $?` — expected exit 0, including `tests/integration/seed/seed.test.ts` (derived loops equal gold, pending 4).

If the eval reports a ticket state or breakdown that differs from the story `expect`, change the story events (dates, due dates), not the engine, and rebuild.

- [ ] **Step 8: Commit**

```bash
npx pnpm@11.25.0 format
git add scripts/build-fixtures.ts fixtures tests
git commit -m "feat: demo go-live tickets from Linear and real-domain demo permalinks"
```

- [ ] **Step 9: Turn on the waiting e2e tests**

Remove `.fixme` from the tests added in Tasks 5 and 6. Run: `npx pnpm@11.25.0 test:e2e > /tmp/e2e.log 2>&1; echo $?`. Expected: exit 0, all tests pass. Commit: `git commit -am "test: ticket e2e tests run against the seeded tickets"`.

---

### Task 8: Agent recipe, tool text and SRD

**Files:**
- Modify: `docs/mcp-agent-recipe.md`
- Modify: `src/server/mcp/tools.ts:134` (`import_records` description)
- Modify: `docs/superpowers/specs/2026-10-12-promise-graph-srd.md:604-605` (`Loop` type)
- Test: `tests/integration/adapters/mcp.test.ts` (tool listing size)

- [ ] **Step 1: Extend the tool description**

In `src/server/mcp/tools.ts`, in the `import_records` description, after `optional externalId/threadExternalId/parentExternalId`, add `, permalink (https; Slack, Gmail and Linear permalinks show as links)`.

- [ ] **Step 2: Add the recipe section**

Append to `docs/mcp-agent-recipe.md` a section "Tickets from Linear" with the content of spec 6.1, 6.2 and 6.3: the record field table, the event-to-act table, the rules (one level, no milestone on a ticket, parent first in the batch, a top-level loop never carries `parentLoopId: null`), and this example batch:

The ticket record body is `Issue PG-118 Dynamics CRM sync job. State: Todo → In Progress. Due date: 2026-10-13. Estimate: 5 points.`, so the quote runs from UTF-16 offset 36 to 84. Use the shape of the existing example in section 6 (the act `quote` sits next to `value`):

```json
{
  "proposalId": "7f0c1d2e-0000-4000-8000-000000000101",
  "expectedProposalRevision": 0,
  "expectedEvidenceRevision": 14,
  "idempotencyKey": "linear-pg-118-1",
  "operations": [
    {
      "op": "put", "collection": "loops",
      "value": {
        "id": "7f0c1d2e-0000-4000-8000-000000000110",
        "title": "PG-118 Dynamics CRM sync job",
        "customer": { "kind": "person", "personId": "7f0c1d2e-0000-4000-8000-000000000150" },
        "performer": { "kind": "person", "personId": "7f0c1d2e-0000-4000-8000-000000000151" },
        "performerDepartmentId": "7f0c1d2e-0000-4000-8000-000000000120",
        "milestoneId": null,
        "parentLoopId": "7f0c1d2e-0000-4000-8000-000000000100"
      }
    },
    {
      "op": "put", "collection": "acts",
      "quote": "State: Todo → In Progress. Due date: 2026-10-13.",
      "value": {
        "id": "7f0c1d2e-0000-4000-8000-000000000130",
        "citation": { "recordVersionId": "7f0c1d2e-0000-4000-8000-000000000140", "start": 36, "end": 84 },
        "type": "promise",
        "actor": { "kind": "person", "personId": "7f0c1d2e-0000-4000-8000-000000000151" },
        "customer": { "kind": "person", "personId": "7f0c1d2e-0000-4000-8000-000000000150" },
        "performer": { "kind": "person", "personId": "7f0c1d2e-0000-4000-8000-000000000151" },
        "action": "ship the Dynamics CRM sync job",
        "due": { "date": "2026-10-13", "precision": "day" },
        "hedged": false,
        "loopId": "7f0c1d2e-0000-4000-8000-000000000110",
        "hidden": false,
        "origin": "agent",
        "confidence": 0.9
      }
    },
    {
      "op": "put", "collection": "recordDecisions",
      "value": { "recordVersionId": "7f0c1d2e-0000-4000-8000-000000000140", "disposition": "included", "reason": "" }
    }
  ]
}
```

Add one sentence under the example: "The ticket loop comes before its acts in the batch, and the parent loop must already be in the snapshot or come earlier in the same batch."

- [ ] **Step 3: Update the SRD**

In `docs/superpowers/specs/2026-10-12-promise-graph-srd.md`, in the `Loop` type, add `parentLoopId?` with one line: "Present only on a ticket; names a top-level loop; a ticket has no milestone. See the Linear tickets design."

- [ ] **Step 4: Run the MCP tests**

Run: `npx pnpm@11.25.0 exec vitest run tests/integration/adapters/mcp.test.ts > /tmp/mcp.log 2>&1; echo $?`
Expected: exit 0; the tool listing stays under 50,000 characters.

- [ ] **Step 5: Commit**

```bash
npx pnpm@11.25.0 format
git add docs src/server/mcp/tools.ts
git commit -m "docs: agent recipe for Linear tickets"
```

---

### Task 9: Gates and PR

- [ ] **Step 1: Run every gate**

```bash
for g in typecheck lint format:check check:providers eval test build; do
  npx pnpm@11.25.0 $g > /tmp/gate-$g.log 2>&1; echo "$g rc=$?"
done
npx pnpm@11.25.0 test:e2e > /tmp/gate-e2e.log 2>&1; echo "e2e rc=$?"
```

Expected: every `rc=0`; read the summary lines.

- [ ] **Step 2: Show the owner**

Run the branch on a local server against a fresh database, sign in, and show the go-live chip, the expanded tickets, the panel section and the list view. Push only after the owner says yes.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin HEAD:refs/heads/phucluu/linear-tickets
gh pr create --draft --base phucluu/promise-graph --head phucluu/linear-tickets \
  --title "9/9 Linear tickets as child loops" --body-file /tmp/pr-body.md
```

The PR body lists the owner decisions (spec 1), the schema step and its one-way nature (spec 3.1), the demo changes (spec 7) and the test results. End it with the harness attribution line for PR bodies.
