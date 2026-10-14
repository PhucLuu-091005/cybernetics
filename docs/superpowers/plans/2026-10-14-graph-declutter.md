# Graph Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the owner's review of the PR #7 graph screen: no edge bar on the active sidebar item, a Miro-style canvas panel (zoom, frozen axis and lane column, controls, % menu, minimap, full screen, zoom to a loop, bigger events), drag of event dots inside their day and lane, and the message source (as an app icon) with a link on every event.

**Architecture:** The layout engine stays pure. It now emits each glyph's day bounds. A new pure function `applyLayoutOffsets` moves dots and branches from a small offsets object, which the browser keeps in `localStorage`. The graph view API adds the source of every cited record version. The browser picks the link target and shows it in a detail-zoom label and in an interactive hover card.

**Tech Stack:** TypeScript 5.9, Next.js 16.4, React 19.2, `@xyflow/react` 12, Zod 4.6, Vitest 4.1, Playwright 1.64, PostgreSQL 17.

**Spec:** [Graph declutter design](../specs/2026-10-14-graph-declutter-design.md). **Mockups:** [sidebar, icons and labels](../../design/2026-10-14-graph-declutter.html), [canvas panel](../../design/2026-10-14-graph-canvas.html).

## Global Constraints

- Work on branch `phucluu/graph-declutter`, created from `origin/phucluu/pg-06`. Never work in the owner's checkouts.
- Commit identity: `PhucLuu-091005 <187116949+PhucLuu-091005@users.noreply.github.com>` for author and committer. Never add `Co-Authored-By` or any other AI trailer.
- `pnpm` is not on `PATH`. Run it as `npx pnpm@11.25.0 <script>`. Never bypass `minimumReleaseAge`.
- Test environment: `export TEST_DATABASE_URL=postgresql://promise_graph:local-development-only@localhost:55432/promise_graph DATABASE_URL=$TEST_DATABASE_URL AUTH_MODE=local SESSION_SECRET=ci-only-32-byte-session-secret-not-for-production-use NEXT_PUBLIC_APP_URL=http://localhost:3000 NEXT_TELEMETRY_DISABLED=1`.
- Capture real exit codes: `cmd > log 2>&1; echo $?`. Read the Vitest summary line (`Tests  N passed (N)`) or the Playwright summary (`N passed`).
- Code style: Prettier (2-space indent, 100 columns, single quotes). Run `npx pnpm@11.25.0 format` before each commit. Comments explain WHY only.
- Dragged positions change the display only. They never change a date, an act, a loop or a snapshot, and they never create a proposal.
- Storage key: `promise-graph:layout:v1:{projectId}`. Caps: 3,000 act entries, 300 loop entries.
- Canvas base scale: 18 px per day, row height 64 px, act node 28 px, hit radius 14 px. Zoom 10 %–400 %, steps 10, 25, 50, 75, 100, 125, 150, 200, 300, 400 %. Titles show from 60 %, act and source labels from 80 %. First view: 100 % with T at 80 % of the width.
- Wheel scrolls; Shift + wheel scrolls sideways; Ctrl/Cmd + wheel or pinch zooms around the pointer; a drag on empty canvas moves it. No keyboard shortcuts.
- Label room rule (layout px, independent of zoom): 90 px or more gives the app icon and the source label; 24 px to 89 px gives the icon only; under 24 px gives no source label. The act label shows only when its full text fits (characters × 5.8 px). The last glyph on a branch has 160 px of room.
- A permalink is a link only when it is `https://` and either the source is native `slack` or `gmail`, or the host is `slack.com` (or a subdomain), `mail.google.com` or `linear.app`. Any other permalink stays plain text. The same host decides the source icon.
- Hover card close delay: 200 ms. Drag threshold: 4 px.

## Review Focus

1. Touch drag on a dot (phone or tablet): the dot drags, the page does not scroll, and a two-finger pinch still zooms. Test in Task 12.
2. A click on a source label at 100 %: the link opens. The label sits outside the branch's click target, so no loop gets selected. Test in Task 11.
3. Tab at 100 %: Tab still walks milestones, then branches; source labels never take focus. Test in Task 11.
4. Ctrl/Cmd + wheel inside the canvas: the canvas zooms and the browser page does not. Test in Task 6.
5. Escape with the hover card and the loop panel both open: the first Escape closes only the card; the second closes the panel. Test in Task 10.

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/app/globals.css` | Active-item style, canvas stage, controls, minimap, card, labels, drag cursor | 1, 6, 7, 8, 10, 11, 12 |
| `src/lib/graph-layout/time.ts` | `dayRange` on the time scale | 2 |
| `src/contracts/layout.ts` | `dayStartX`, `dayEndX` on `ActGlyph` | 2 |
| `src/lib/graph-layout/path.ts` (new) | Branch path geometry shared by layout and offsets | 2 |
| `src/lib/graph-layout/index.ts` | Emit day bounds, use `branchPath`, re-exports | 2, 3, 5 |
| `src/lib/graph-layout/offsets.ts` (new) | `applyLayoutOffsets`, `actXInDay`, `LayoutOffsets` | 3 |
| `src/components/graph/offset-store.ts` (new) | Read and write offsets in browser storage | 4 |
| `src/lib/graph-layout/viewport.ts` (new) | Fit, zoom steps, zoom around a point, axis ticks, level of detail, minimap mapping | 5 |
| `src/components/graph/LaneColumn.tsx`, `TimeAxis.tsx` (new) | Frozen lane column and time axis | 6 |
| `src/components/graph/PromiseGraph.tsx` | Canvas stage, viewport, reveal, controls, minimap, full screen, hover and drag wiring | 6, 7, 8, 10, 12 |
| `src/components/graph/FilterBar.tsx` | Loses the zoom control; gains "Reset layout" | 6, 12 |
| `src/components/graph/CanvasControls.tsx` (new) | Toolbar and % menu | 7 |
| `src/components/graph/Minimap.tsx` (new) | Minimap from the layout | 8 |
| `src/contracts/views.ts` | `GraphSourceSchema`, `sources` on `GraphView` | 9 |
| `src/server/domain/graph/read.ts` | Fill `sources` | 9 |
| `src/lib/source-app.ts` (new) | Source app from source kind and permalink domain; linkable rule | 9 |
| `src/components/graph/source-link.ts` (new) | Link target and the act's source | 9 |
| `src/components/graph/SourceIcon.tsx`, `ActCard.tsx` (new) | App icons; the hover card | 10 |
| `src/components/graph/ui-context.ts` | Graph UI callbacks and level of detail | 6, 7, 10, 11, 12 |
| `src/components/graph/act-labels.ts` (new) | Label text and room rule | 11 |
| `src/components/graph/BranchEdge.tsx` | Titles, labels, hit dots, double-click, drag start | 6, 7, 10, 11, 12 |
| `src/components/graph/ActNode.tsx`, `MilestoneNode.tsx` | 28 px glyph; names by level of detail | 6, 11 |
| `src/components/graph/use-act-drag.ts` (new) | Pointer drag state | 12 |
| `src/components/graph/GraphScreen.tsx` | Base-scale layout, offsets state, card state, reset | 6, 9, 10, 11, 12 |
| `src/app/(app)/projects/[id]/graph/page.tsx` | Pass `sources` | 9 |

---|---|---|
| `src/app/globals.css` | Active-item style, lane column, card, labels, drag cursor | 1, 5, 7, 8, 9 |
| `src/lib/graph-layout/time.ts` | `dayRange` on the time scale | 2 |
| `src/contracts/layout.ts` | `dayStartX`, `dayEndX` on `ActGlyph` | 2 |
| `src/lib/graph-layout/path.ts` (new) | Branch path geometry shared by layout and offsets | 2 |
| `src/lib/graph-layout/index.ts` | Emit day bounds, use `branchPath`, re-export offsets | 2, 3 |
| `src/lib/graph-layout/offsets.ts` (new) | `applyLayoutOffsets`, `actXInDay`, `LayoutOffsets` | 3 |
| `src/components/graph/offset-store.ts` (new) | Read and write offsets in browser storage | 4 |
| `src/components/graph/LaneColumn.tsx` (new) | Fixed lane-name column | 5 |
| `src/components/graph/LaneLabel.tsx` | Handles only (edge anchors) | 5 |
| `src/components/graph/PromiseGraph.tsx` | Column, hover and drag wiring | 5, 7, 9 |
| `src/contracts/views.ts` | `GraphSourceSchema`, `sources` on `GraphView` | 6 |
| `src/server/domain/graph/read.ts` | Fill `sources` | 6 |
| `src/lib/source-app.ts` (new) | Source app from source kind and permalink domain; linkable rule | 6 |
| `src/components/graph/source-link.ts` (new) | Link target and the act's source | 6 |
| `src/components/graph/SourceIcon.tsx` (new) | App icons (Slack `#`, Gmail, Linear, paste, agent) | 7 |
| `src/components/graph/ActCard.tsx` (new) | Interactive hover card | 7 |
| `src/components/graph/ui-context.ts` | Graph UI callbacks | 7, 8, 9 |
| `src/components/graph/act-labels.ts` (new) | Detail-zoom label text and room rule | 8 |
| `src/components/graph/BranchEdge.tsx` | Labels, hit dots, drag start | 7, 8, 9 |
| `src/components/graph/ActNode.tsx` | Glyph only | 8 |
| `src/components/graph/use-act-drag.ts` (new) | Pointer drag state | 9 |
| `src/components/graph/GraphScreen.tsx` | Offsets state, card state, row height, reset | 7, 8, 9 |
| `src/components/graph/FilterBar.tsx` | "Reset layout" button | 9 |
| `src/app/(app)/projects/[id]/graph/page.tsx` | Pass `sources` | 6 |

---

### Task 1: Active sidebar and inbox items without the edge bar

**Files:**
- Modify: `src/app/globals.css` (`.nav a[aria-current='page']` near line 232, `.ritem[aria-current='true']` near line 1034)
- Test: `tests/e2e/graph.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing test** (append to `tests/e2e/graph.spec.ts`)

```ts
test('the active sidebar item has bold text and no edge bar', async ({ page }) => {
  await signIn(page);
  const active = page
    .getByRole('navigation', { name: 'Project' })
    .locator('a[aria-current="page"]');
  await expect(active).toHaveText('Graph');
  const style = await active.evaluate((node) => {
    const computed = getComputedStyle(node);
    return { shadow: computed.boxShadow, weight: Number(computed.fontWeight) };
  });
  expect(style.shadow).toBe('none');
  expect(style.weight).toBeGreaterThanOrEqual(700);
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts -g "edge bar" > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 1. The log shows `Expected: "none"` and `Received: "rgb(23, 33, 45) 3px 0px 0px 0px inset"`.

- [ ] **Step 3: Change the styles**

In `src/app/globals.css`, replace:

```css
  .nav a[aria-current='page'] {
    background: var(--surface);
    color: var(--ink);
    box-shadow: inset 3px 0 0 var(--ink);
  }
```

with:

```css
  .nav a[aria-current='page'] {
    background: var(--surface);
    color: var(--ink);
    font-weight: 700;
  }
```

Replace:

```css
  .ritem[aria-current='true'] {
    border-color: var(--ink);
    box-shadow: inset 3px 0 0 var(--ink);
  }
```

with:

```css
  .ritem[aria-current='true'] {
    border-color: var(--ink);
  }
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts -g "edge bar" > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 0, `1 passed`.

- [ ] **Step 5: Commit**

```bash
npx pnpm@11.25.0 format
git add src/app/globals.css tests/e2e/graph.spec.ts
git commit -m "style: mark the active sidebar item without an edge bar"
```

---

### Task 2: Day bounds on every glyph and a shared branch path

**Files:**
- Modify: `src/lib/graph-layout/time.ts` (the `TimeScale` interface and `createTimeScale`)
- Modify: `src/contracts/layout.ts` (`ActGlyphSchema`)
- Create: `src/lib/graph-layout/path.ts`
- Modify: `src/lib/graph-layout/index.ts` (constants block near line 20, glyph creation near line 300, path near line 316)
- Test: `tests/unit/layout/layout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TimeScale.dayRange(instant: string): { start: number; end: number }`
  - `ActGlyph.dayStartX: number`, `ActGlyph.dayEndX: number`
  - `branchPath(xStart: number, xEnd: number, y: number, trunkY: number, merge: boolean): string` and `CURVE = 16`, exported from `src/lib/graph-layout`.

- [ ] **Step 1: Write the failing tests** (append inside `describe('layoutPromiseGraph design rules', ...)` in `tests/unit/layout/layout.test.ts`; add `branchPath` and `createTimeScale` to the import from `'../../../src/lib/graph-layout'`)

```ts
  it('gives each glyph the bounds of its local day', () => {
    for (const b of layout(12).branches)
      for (const g of b.glyphs) {
        expect(g.dayEndX - g.dayStartX).toBeCloseTo(12, 5);
        expect(g.x).toBeGreaterThanOrEqual(g.dayStartX);
        expect(g.x).toBeLessThanOrEqual(g.dayEndX);
      }
  });
  it('keeps day bounds on the local calendar across a daylight saving change', () => {
    const context = {
      ...snapshot.context,
      timeZone: 'America/New_York',
      windowStart: '2026-03-07',
    };
    const scale = createTimeScale(context, 10);
    expect(scale.dayRange('2026-03-08T23:30:00-04:00')).toEqual({ start: 10, end: 20 });
    expect(scale.dayRange('2026-03-09T00:00:00-04:00')).toEqual({ start: 20, end: 30 });
  });
  it('builds every branch path with the shared path function', () => {
    const l = layout();
    for (const b of l.branches)
      expect(branchPath(b.xStart, b.xEnd, b.y, l.trunkY, b.endKind === 'merge')).toBe(b.path);
  });
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/layout/layout.test.ts > /tmp/unit.log 2>&1; echo $?`
Expected: exit 1. The log shows `branchPath is not a function` or `dayRange is not a function`.

- [ ] **Step 3: Add `dayRange` to the time scale**

In `src/lib/graph-layout/time.ts`, add to `interface TimeScale` after `dateEndX`:

```ts
  /** x of the start and the end of the local calendar day that contains the instant. */
  dayRange(instant: string): { start: number; end: number };
```

In the object that `createTimeScale` returns, add after `dateEndX`:

```ts
    dayRange(instant) {
      const day = locate(Date.parse(instant));
      return { start: day.index * pxPerDay, end: (day.index + 1) * pxPerDay };
    },
```

- [ ] **Step 4: Add the day bounds to the contract**

In `src/contracts/layout.ts`, change `ActGlyphSchema` to:

```ts
export const ActGlyphSchema = z.strictObject({
  id: IdSchema,
  loopId: IdSchema,
  type: ActTypeSchema,
  x: coordinate,
  y: coordinate,
  dayStartX: coordinate,
  dayEndX: coordinate,
  glyph: TextSchema,
  label: TextSchema,
  accessibleName: TextSchema,
});
```

- [ ] **Step 5: Create the shared path function**

Create `src/lib/graph-layout/path.ts`:

```ts
// Curve geometry from the approved design file (docs/design/2026-10-13-promise-graph-ui.html).
export const CURVE = 16;
const num = (value: number) => String(Math.round(value * 100) / 100);

export function branchPath(
  xStart: number,
  xEnd: number,
  y: number,
  trunkY: number,
  merge: boolean,
): string {
  const fork = `M${num(xStart - CURVE)} ${num(trunkY)} C${num(xStart - 4)} ${num(trunkY)} ${num(xStart - 12)} ${num(y)} ${num(xStart)} ${num(y)} H${num(xEnd)}`;
  return merge
    ? `${fork} C${num(xEnd + 12)} ${num(y)} ${num(xEnd + 4)} ${num(trunkY)} ${num(xEnd + CURVE)} ${num(trunkY)}`
    : fork;
}
```

- [ ] **Step 6: Use it in the layout and emit the day bounds**

In `src/lib/graph-layout/index.ts`:

1. Add `import { CURVE, branchPath } from './path';` and `export { CURVE, branchPath } from './path';` below the existing `export { createTimeScale, ... } from './time';` line.
2. Change the constants block to remove `CURVE`:

```ts
const AXIS_HEIGHT = 26,
  TRUNK_BAND = 58,
  BOTTOM_MARGIN = 30;
```

3. In the glyph creation inside `layoutPromiseGraph`, replace the returned glyph object with:

```ts
        const actor = partyLabels(act.actor, people),
          day = scale.dayRange(act.occurredAt);
        return [
          {
            id: act.id,
            loopId: loop.loop.id,
            type: act.type,
            x: round(scale.x(act.occurredAt)),
            y,
            dayStartX: round(day.start),
            dayEndX: round(day.end),
            glyph: GLYPH[act.type],
            label: `${ACT_LABEL[act.type].toLowerCase()} ${actor.initials}`,
            accessibleName: `${ACT_LABEL[act.type]} by ${actor.name}, ${scale.localStamp(act.occurredAt)}`,
          },
        ];
```

4. Delete the `fork` and `merge` constants and set `path: branchPath(xStart, xEnd, y, trunkY, endKind === 'merge'),` in the returned branch.
5. Delete the now unused `num` helper if no other line uses it (`grep -n "num(" src/lib/graph-layout/index.ts`).

- [ ] **Step 7: Find other glyph constructions**

Run: `npx pnpm@11.25.0 typecheck > /tmp/tsc.log 2>&1; echo $?`
Expected: exit 0. If a test or a component builds an `ActGlyph` by hand, the log names it. Add `dayStartX: x` and `dayEndX: x + pxPerDay` there, with the `x` and `pxPerDay` of that construction.

- [ ] **Step 8: Run the tests and see them pass**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/layout > /tmp/unit.log 2>&1; echo $?`
Expected: exit 0. All layout tests pass, including `is deterministic` and `returns output that satisfies the layout contract`.

- [ ] **Step 9: Commit**

```bash
npx pnpm@11.25.0 format
git add src/lib/graph-layout src/contracts/layout.ts tests/unit/layout/layout.test.ts
git commit -m "feat: day bounds on graph glyphs and a shared branch path"
```

---

### Task 3: Pure layout offsets

**Files:**
- Create: `src/lib/graph-layout/offsets.ts`
- Modify: `src/lib/graph-layout/index.ts` (re-export)
- Test: `tests/unit/layout/offsets.test.ts`

**Interfaces:**
- Consumes: `branchPath` (Task 2), `ActGlyph.dayStartX/dayEndX` (Task 2).
- Produces (exported from `src/lib/graph-layout`):
  - `type LayoutOffsets = { acts: Record<string, number>; loops: Record<string, number> }`
  - `NO_OFFSETS: LayoutOffsets`
  - `actXInDay(dayStartX: number, dayEndX: number, fraction: number): number`
  - `applyLayoutOffsets(layout: GraphLayout, offsets: LayoutOffsets, rowHeight: number): GraphLayout`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/layout/offsets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  NO_OFFSETS,
  applyLayoutOffsets,
  layoutPromiseGraph,
} from '../../../src/lib/graph-layout';
import { deriveProject } from '../../../src/server/loops/engine';
import main from '../../../fixtures/main-snapshot.json';
import records from '../../../fixtures/records.json';
import gold from '../../../fixtures/gold.json';
import { engineInputFromFixtures } from '../../../scripts/build-fixtures';
import type { GraphSnapshot } from '../../../src/contracts';
import { GraphLayoutSchema, type GraphLayout } from '../../../src/contracts/layout';

const snapshot = main as GraphSnapshot;
const engine = deriveProject(
  engineInputFromFixtures(
    snapshot,
    records.filter((r) => r.projectKey === 'larkspur'),
    gold.T,
  ),
);
const at = (rowHeight: number) =>
  layoutPromiseGraph(engine, { context: snapshot.context }, { pxPerDay: 44, rowHeight });
const base = at(28);
const branchOf = (layout: GraphLayout, id: string) => layout.branches.find((b) => b.id === id)!;

describe('applyLayoutOffsets', () => {
  it('leaves the layout unchanged without offsets', () => {
    expect(applyLayoutOffsets(base, NO_OFFSETS, 28)).toEqual(base);
  });
  it('ignores offsets for acts and loops that are not in the layout', () => {
    const offsets = { acts: { 'no-such-act': 0.2 }, loops: { 'no-such-loop': 40 } };
    expect(applyLayoutOffsets(base, offsets, 28)).toEqual(base);
  });
  it('keeps a moved dot inside its day', () => {
    const b = base.branches.find((item) => item.glyphs.length >= 2)!,
      g = b.glyphs[1];
    const x = (fraction: number) =>
      branchOf(applyLayoutOffsets(base, { acts: { [g.id]: fraction }, loops: {} }, 28), b.id)
        .glyphs[1].x;
    expect(x(0)).toBe(g.dayStartX);
    expect(x(-3)).toBe(g.dayStartX);
    expect(x(0.5)).toBeCloseTo((g.dayStartX + g.dayEndX) / 2, 1);
    expect(x(7)).toBeCloseTo(g.dayEndX - 0.5, 2);
  });
  it('shifts the whole branch and keeps it inside its lane on both sides and both row heights', () => {
    for (const rowHeight of [28, 64]) {
      const layout = at(rowHeight);
      for (const side of ['vendor', 'client'] as const) {
        const lane = layout.lanes.find(
          (item) =>
            item.side === side && layout.branches.some((b) => b.departmentId === item.departmentId),
        )!;
        const b = layout.branches.find((item) => item.departmentId === lane.departmentId)!;
        for (const shift of [-1000, 1000]) {
          const moved = branchOf(
            applyLayoutOffsets(layout, { acts: {}, loops: { [b.loopId]: shift } }, rowHeight),
            b.id,
          );
          expect(moved.y).toBeGreaterThanOrEqual(lane.y + rowHeight / 2);
          expect(moved.y).toBeLessThanOrEqual(lane.y + lane.height - rowHeight / 2);
          expect(moved.glyphs.every((g) => g.y === moved.y)).toBe(true);
          expect(moved.breakdownMarkers.every((m) => m.y === moved.y)).toBe(true);
          expect(moved.path).toContain(` ${moved.y} H`);
        }
      }
    }
  });
  it('stretches the branch line when a dot moves past its start', () => {
    const b = base.branches.find(
      (item) => item.glyphs.length > 0 && item.glyphs[0].x - item.glyphs[0].dayStartX > 1,
    )!;
    const g = b.glyphs[0];
    const moved = branchOf(applyLayoutOffsets(base, { acts: { [g.id]: 0 }, loops: {} }, 28), b.id);
    expect(moved.xStart).toBe(g.dayStartX);
    expect(moved.segments[0].startX).toBe(g.dayStartX);
    expect(moved.path.startsWith(`M${Math.round((g.dayStartX - 16) * 100) / 100} `)).toBe(true);
  });
  it('never shortens the branch line', () => {
    const b = base.branches.find(
      (item) => item.glyphs.length > 0 && item.glyphs[0].dayEndX - item.glyphs[0].x > 1,
    )!;
    const g = b.glyphs[0];
    const moved = branchOf(applyLayoutOffsets(base, { acts: { [g.id]: 1 }, loops: {} }, 28), b.id);
    expect(moved.xStart).toBe(b.xStart);
    expect(moved.xEnd).toBeGreaterThanOrEqual(b.xEnd);
  });
  it('returns output that satisfies the layout contract', () => {
    const b = base.branches[0];
    const offsets = {
      acts: Object.fromEntries(b.glyphs.map((g) => [g.id, 0.9])),
      loops: { [b.loopId]: -5 },
    };
    expect(GraphLayoutSchema.safeParse(applyLayoutOffsets(base, offsets, 28)).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/layout/offsets.test.ts > /tmp/unit.log 2>&1; echo $?`
Expected: exit 1. The log shows `applyLayoutOffsets is not a function` or a missing export.

- [ ] **Step 3: Write the implementation**

Create `src/lib/graph-layout/offsets.ts`:

```ts
import type { BranchLayout, GraphLayout } from '../../contracts/layout';
import { branchPath } from './path';

export type LayoutOffsets = {
  /** Position of the dot inside its local day: 0 = day start, 1 = day end. */
  acts: Record<string, number>;
  /** Vertical shift of the branch line in px. Positive moves down. */
  loops: Record<string, number>;
};
export const NO_OFFSETS: LayoutOffsets = { acts: {}, loops: {} };

const round = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
// Half a pixel short of the next day, so a dot at the right edge never reads as the next date.
const DAY_EDGE = 0.5;

export function actXInDay(dayStartX: number, dayEndX: number, fraction: number): number {
  return round(
    clamp(dayStartX + fraction * (dayEndX - dayStartX), dayStartX, dayEndX - DAY_EDGE),
  );
}

export function applyLayoutOffsets(
  layout: GraphLayout,
  offsets: LayoutOffsets,
  rowHeight: number,
): GraphLayout {
  const lanes = new Map(layout.lanes.map((lane) => [lane.departmentId, lane]));
  let changed = false;
  const branches = layout.branches.map((branch): BranchLayout => {
    const shift = offsets.loops[branch.loopId];
    const moved = branch.glyphs.some((glyph) => offsets.acts[glyph.id] !== undefined);
    const lane = lanes.get(branch.departmentId);
    if ((shift === undefined && !moved) || !lane) return branch;
    changed = true;
    const y =
      shift === undefined
        ? branch.y
        : round(
            clamp(branch.y + shift, lane.y + rowHeight / 2, lane.y + lane.height - rowHeight / 2),
          );
    const glyphs = branch.glyphs.map((glyph) => {
      const fraction = offsets.acts[glyph.id];
      return {
        ...glyph,
        y,
        x: fraction === undefined ? glyph.x : actXInDay(glyph.dayStartX, glyph.dayEndX, fraction),
      };
    });
    const xs = glyphs.map((glyph) => glyph.x);
    const xStart = Math.min(branch.xStart, ...xs),
      xEnd = Math.max(branch.xEnd, ...xs);
    const segments = branch.segments.map((segment, index, all) => ({
      ...segment,
      startX: index === 0 ? Math.min(segment.startX, xStart) : segment.startX,
      endX: index === all.length - 1 ? Math.max(segment.endX, xEnd) : segment.endX,
    }));
    return {
      ...branch,
      y,
      xStart,
      xEnd,
      glyphs,
      segments,
      breakdownMarkers: branch.breakdownMarkers.map((marker) => ({ ...marker, y })),
      path: branchPath(xStart, xEnd, y, layout.trunkY, branch.endKind === 'merge'),
    };
  });
  return changed ? { ...layout, branches } : layout;
}
```

In `src/lib/graph-layout/index.ts`, add:

```ts
export { NO_OFFSETS, actXInDay, applyLayoutOffsets, type LayoutOffsets } from './offsets';
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/layout > /tmp/unit.log 2>&1; echo $?`
Expected: exit 0. All layout and offset tests pass.

- [ ] **Step 5: Commit**

```bash
npx pnpm@11.25.0 format
git add src/lib/graph-layout tests/unit/layout/offsets.test.ts
git commit -m "feat: pure layout offsets that keep dots in their day and branches in their lane"
```

---

### Task 4: Offset store in browser storage

**Files:**
- Create: `src/components/graph/offset-store.ts`
- Test: `tests/unit/graph/offset-store.test.ts`

**Interfaces:**
- Consumes: `LayoutOffsets`, `NO_OFFSETS` (Task 3).
- Produces:
  - `type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>`
  - `offsetKey(projectId: string): string`
  - `browserStore(): KeyValueStore | null`
  - `readOffsets(store: KeyValueStore | null, projectId: string): LayoutOffsets`
  - `writeOffsets(store: KeyValueStore | null, projectId: string, offsets: LayoutOffsets): void`
  - `withOffset(offsets: LayoutOffsets, kind: 'acts' | 'loops', id: string, value: number): LayoutOffsets`
  - `hasOffsets(offsets: LayoutOffsets): boolean`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/graph/offset-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  hasOffsets,
  offsetKey,
  readOffsets,
  withOffset,
  writeOffsets,
  type KeyValueStore,
} from '../../../src/components/graph/offset-store';

const memory = () => {
  const map = new Map<string, string>();
  const store: KeyValueStore = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  return { map, store };
};
const broken: KeyValueStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};
const P = 'project-1';

describe('offset store', () => {
  it('round-trips offsets per project', () => {
    const { store } = memory();
    const offsets = { acts: { a: 0.25 }, loops: { l: -12 } };
    writeOffsets(store, P, offsets);
    expect(readOffsets(store, P)).toEqual(offsets);
    expect(readOffsets(store, 'project-2')).toEqual({ acts: {}, loops: {} });
  });
  it('keeps entries for IDs outside the current layout, so a filtered loop gets its place back', () => {
    const { store } = memory();
    writeOffsets(store, P, { acts: {}, loops: { hidden: 20 } });
    expect(readOffsets(store, P).loops.hidden).toBe(20);
  });
  it('gives empty offsets for invalid JSON, a wrong version, an out-of-range fraction or no store', () => {
    const { map, store } = memory();
    for (const raw of [
      '{',
      JSON.stringify({ v: 2, acts: {}, loops: {} }),
      JSON.stringify({ v: 1, acts: { a: 1.5 }, loops: {} }),
    ]) {
      map.set(offsetKey(P), raw);
      expect(readOffsets(store, P)).toEqual({ acts: {}, loops: {} });
    }
    expect(readOffsets(null, P)).toEqual({ acts: {}, loops: {} });
  });
  it('survives a store that throws', () => {
    expect(readOffsets(broken, P)).toEqual({ acts: {}, loops: {} });
    expect(() => writeOffsets(broken, P, { acts: { a: 0.5 }, loops: {} })).not.toThrow();
  });
  it('removes the key when the offsets are empty', () => {
    const { map, store } = memory();
    writeOffsets(store, P, { acts: { a: 0.5 }, loops: {} });
    writeOffsets(store, P, { acts: {}, loops: {} });
    expect(map.has(offsetKey(P))).toBe(false);
  });
  it('keeps the newest 3,000 acts and 300 loops', () => {
    const { store } = memory();
    let offsets = { acts: {}, loops: {} } as Parameters<typeof withOffset>[0];
    for (let i = 0; i < 3005; i++) offsets = withOffset(offsets, 'acts', `a${i}`, 0.5);
    for (let i = 0; i < 305; i++) offsets = withOffset(offsets, 'loops', `l${i}`, 1);
    writeOffsets(store, P, offsets);
    const read = readOffsets(store, P);
    expect(Object.keys(read.acts)).toHaveLength(3000);
    expect(read.acts.a0).toBeUndefined();
    expect(read.acts.a3004).toBe(0.5);
    expect(Object.keys(read.loops)).toHaveLength(300);
    expect(read.loops.l0).toBeUndefined();
  });
  it('moves a re-dragged ID to the newest position', () => {
    const offsets = withOffset({ acts: { a: 0.1, b: 0.2 }, loops: {} }, 'acts', 'a', 0.3);
    expect(Object.keys(offsets.acts)).toEqual(['b', 'a']);
    expect(hasOffsets(offsets)).toBe(true);
    expect(hasOffsets({ acts: {}, loops: {} })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/graph/offset-store.test.ts > /tmp/unit.log 2>&1; echo $?`
Expected: exit 1, `Failed to resolve import "../../../src/components/graph/offset-store"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/graph/offset-store.ts`:

```ts
import { z } from 'zod';
import type { LayoutOffsets } from '../../lib/graph-layout';

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
// The snapshot caps: 3,000 acts and 300 loops.
const MAX_ACTS = 3000,
  MAX_LOOPS = 300;
const StoredSchema = z.strictObject({
  v: z.literal(1),
  acts: z.record(z.string(), z.number().min(0).max(1)),
  loops: z.record(z.string(), z.number().finite()),
});
const empty = (): LayoutOffsets => ({ acts: {}, loops: {} });

export const offsetKey = (projectId: string) => `promise-graph:layout:v1:${projectId}`;

/** Private windows and blocked site data make storage missing or throwing; the graph then runs without saved positions. */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readOffsets(store: KeyValueStore | null, projectId: string): LayoutOffsets {
  try {
    const raw = store?.getItem(offsetKey(projectId));
    if (!raw) return empty();
    const parsed = StoredSchema.safeParse(JSON.parse(raw));
    return parsed.success ? { acts: parsed.data.acts, loops: parsed.data.loops } : empty();
  } catch {
    return empty();
  }
}

// Object keys keep insertion order and withOffset re-inserts a dragged ID, so the tail is the newest.
const newest = (entries: Record<string, number>, max: number) =>
  Object.fromEntries(Object.entries(entries).slice(-max));

export function writeOffsets(
  store: KeyValueStore | null,
  projectId: string,
  offsets: LayoutOffsets,
): void {
  try {
    if (!hasOffsets(offsets)) {
      store?.removeItem(offsetKey(projectId));
      return;
    }
    const value = {
      v: 1,
      acts: newest(offsets.acts, MAX_ACTS),
      loops: newest(offsets.loops, MAX_LOOPS),
    };
    store?.setItem(offsetKey(projectId), JSON.stringify(value));
  } catch {
    // A full or blocked store keeps the positions for this page view only.
  }
}

export function withOffset(
  offsets: LayoutOffsets,
  kind: 'acts' | 'loops',
  id: string,
  value: number,
): LayoutOffsets {
  const rest = { ...offsets[kind] };
  delete rest[id];
  return { ...offsets, [kind]: { ...rest, [id]: value } };
}

export const hasOffsets = (offsets: LayoutOffsets) =>
  Object.keys(offsets.acts).length > 0 || Object.keys(offsets.loops).length > 0;
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/graph/offset-store.test.ts > /tmp/unit.log 2>&1; echo $?`
Expected: exit 0, `Tests  7 passed (7)`.

- [ ] **Step 5: Commit**

```bash
npx pnpm@11.25.0 format
git add src/components/graph/offset-store.ts tests/unit/graph/offset-store.test.ts
git commit -m "feat: keep dragged graph positions in browser storage"
```

---

### Task 5: Pure viewport helpers

**Files:**
- Create: `src/lib/graph-layout/viewport.ts`
- Modify: `src/lib/graph-layout/index.ts` (re-export)
- Test: `tests/unit/layout/viewport.test.ts`

**Interfaces:**
- Produces (exported from `src/lib/graph-layout`):
  - `type Viewport = { x: number; y: number; zoom: number }`, `type Box = { x0: number; x1: number; y0: number; y1: number }`, `type Size = { width: number; height: number }`
  - `MIN_ZOOM = 0.1`, `MAX_ZOOM = 4`, `ZOOM_STEPS`, `BASE_PX_PER_DAY = 18`, `BASE_ROW_HEIGHT = 64`
  - `fitViewport(box: Box, size: Size, padding?: number, maxZoom?: number): Viewport`
  - `fitWidth(x0: number, x1: number, centreY: number, size: Size, padding?: number): Viewport`
  - `nextZoom(zoom: number, direction: 1 | -1): number`
  - `zoomAround(view: Viewport, zoom: number, point: { x: number; y: number }): Viewport`
  - `type TickStep = 'day' | 'week' | 'month'`, `tickStep(dayPx: number): TickStep`
  - `type Lod = 0 | 1 | 2`, `lodOf(zoom: number): Lod`
  - `minimapScale(map: Size, content: Box): number`, `minimapViewport(point: { x: number; y: number }, map: Size, content: Box, canvas: Size, zoom: number): Viewport`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/layout/viewport.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  fitViewport,
  fitWidth,
  lodOf,
  minimapViewport,
  nextZoom,
  tickStep,
  zoomAround,
} from '../../../src/lib/graph-layout';

const size = { width: 1000, height: 600 };

describe('viewport helpers', () => {
  it('fits a box inside the canvas with padding and centres it', () => {
    const v = fitViewport({ x0: 0, x1: 1872, y0: 0, y1: 468 }, size, 32);
    expect(v.zoom).toBeCloseTo(0.5, 5);
    expect(v.x + 936 * v.zoom).toBeCloseTo(500, 5);
    expect(v.y + 234 * v.zoom).toBeCloseTo(300, 5);
  });
  it('stops a fit at the maximum zoom', () => {
    expect(fitViewport({ x0: 0, x1: 10, y0: 0, y1: 10 }, size, 48, 1.5).zoom).toBe(1.5);
    expect(fitViewport({ x0: 0, x1: 1e6, y0: 0, y1: 10 }, size).zoom).toBe(MIN_ZOOM);
  });
  it('fits a date range across the width and centres a y', () => {
    const v = fitWidth(100, 640, 300, size, 32);
    expect(v.zoom).toBeCloseTo(936 / 540, 5);
    expect(v.x + 100 * v.zoom).toBeCloseTo(32, 5);
    expect(v.y + 300 * v.zoom).toBeCloseTo(300, 5);
  });
  it('steps through the zoom steps', () => {
    expect(nextZoom(1, 1)).toBe(1.25);
    expect(nextZoom(1, -1)).toBe(0.75);
    expect(nextZoom(0.9, 1)).toBe(1);
    expect(nextZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(nextZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
  it('keeps the point under the pointer when it zooms', () => {
    const v = zoomAround({ x: 10, y: 20, zoom: 1 }, 2, { x: 110, y: 220 });
    expect(v).toEqual({ x: -90, y: -180, zoom: 2 });
    expect(zoomAround({ x: 0, y: 0, zoom: 1 }, 99, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
  });
  it('labels days, weeks or months by the screen width of a day', () => {
    expect([tickStep(72), tickStep(56), tickStep(20), tickStep(8), tickStep(5)]).toEqual([
      'day',
      'day',
      'week',
      'week',
      'month',
    ]);
  });
  it('shows titles from 60 % and labels from 80 %', () => {
    expect([lodOf(0.4), lodOf(0.6), lodOf(0.79), lodOf(0.8), lodOf(2)]).toEqual([0, 1, 1, 2, 2]);
  });
  it('centres the canvas on a minimap point', () => {
    const content = { x0: 0, x1: 2200, y0: 0, y1: 1200 };
    const map = { width: 220, height: 120 };
    const v = minimapViewport({ x: 110, y: 60 }, map, content, size, 1);
    expect(v.x + 1100).toBeCloseTo(500, 5);
    expect(v.y + 600).toBeCloseTo(300, 5);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/layout/viewport.test.ts > /tmp/unit.log 2>&1; echo $?`
Expected: exit 1, missing exports.

- [ ] **Step 3: Write the helpers**

Create `src/lib/graph-layout/viewport.ts`:

```ts
export type Viewport = { x: number; y: number; zoom: number };
export type Box = { x0: number; x1: number; y0: number; y1: number };
export type Size = { width: number; height: number };

export const MIN_ZOOM = 0.1,
  MAX_ZOOM = 4;
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
// The canvas scale at 100 %: a day, a row and an act node in layout px.
export const BASE_PX_PER_DAY = 18,
  BASE_ROW_HEIGHT = 64;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function fitViewport(box: Box, size: Size, padding = 32, maxZoom = MAX_ZOOM): Viewport {
  const width = box.x1 - box.x0,
    height = box.y1 - box.y0;
  const zoom = clamp(
    Math.min((size.width - padding * 2) / width, (size.height - padding * 2) / height),
    MIN_ZOOM,
    maxZoom,
  );
  return {
    zoom,
    x: (size.width - width * zoom) / 2 - box.x0 * zoom,
    y: (size.height - height * zoom) / 2 - box.y0 * zoom,
  };
}

/** A date range across the canvas width; a full-height fit would stop near 40 % on a project with seven lanes. */
export function fitWidth(x0: number, x1: number, centreY: number, size: Size, padding = 32): Viewport {
  const zoom = clamp((size.width - padding * 2) / (x1 - x0), MIN_ZOOM, MAX_ZOOM);
  return { zoom, x: padding - x0 * zoom, y: size.height / 2 - centreY * zoom };
}

export function nextZoom(zoom: number, direction: 1 | -1): number {
  return direction > 0
    ? (ZOOM_STEPS.find((step) => step > zoom + 1e-3) ?? MAX_ZOOM)
    : ([...ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-3) ?? MIN_ZOOM);
}

export function zoomAround(view: Viewport, zoom: number, point: { x: number; y: number }): Viewport {
  const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const worldX = (point.x - view.x) / view.zoom,
    worldY = (point.y - view.y) / view.zoom;
  return { zoom: next, x: point.x - worldX * next, y: point.y - worldY * next };
}

export type TickStep = 'day' | 'week' | 'month';
// A day label ("12 Sept") needs about 56 px; below 8 px per day even week labels collide.
export const tickStep = (dayPx: number): TickStep =>
  dayPx >= 56 ? 'day' : dayPx >= 8 ? 'week' : 'month';

export type Lod = 0 | 1 | 2;
// Under 60 % the 11 px titles fall below 7 px; under 80 % the 10 px labels fall below 8 px.
export const lodOf = (zoom: number): Lod => (zoom >= 0.8 ? 2 : zoom >= 0.6 ? 1 : 0);

export const minimapScale = (map: Size, content: Box) =>
  Math.min(map.width / (content.x1 - content.x0), map.height / (content.y1 - content.y0));

export function minimapViewport(
  point: { x: number; y: number },
  map: Size,
  content: Box,
  canvas: Size,
  zoom: number,
): Viewport {
  const scale = minimapScale(map, content);
  const offsetX = (map.width - (content.x1 - content.x0) * scale) / 2,
    offsetY = (map.height - (content.y1 - content.y0) * scale) / 2;
  const x = content.x0 + (point.x - offsetX) / scale,
    y = content.y0 + (point.y - offsetY) / scale;
  return { zoom, x: canvas.width / 2 - x * zoom, y: canvas.height / 2 - y * zoom };
}
```

In `src/lib/graph-layout/index.ts`, add `export * from './viewport';`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/layout/viewport.test.ts > /tmp/unit.log 2>&1; echo $?`
Expected: exit 0, `Tests  8 passed (8)`.

- [ ] **Step 5: Commit**

```bash
npx pnpm@11.25.0 format
git add src/lib/graph-layout tests/unit/layout/viewport.test.ts
git commit -m "feat: pure viewport helpers for the graph canvas"
```

---

### Task 6: Canvas stage with frozen axis and lane column

**Files:**
- Create: `src/components/graph/LaneColumn.tsx`, `src/components/graph/TimeAxis.tsx`
- Modify: `src/components/graph/PromiseGraph.tsx`, `GraphScreen.tsx`, `FilterBar.tsx`, `LaneLabel.tsx`, `ActNode.tsx`, `BranchEdge.tsx`, `MilestoneNode.tsx`, `ui-context.ts`
- Modify: `src/app/globals.css`
- Modify: `docs/superpowers/specs/2026-10-12-promise-graph-srd.md` (section 7.2)
- Test: `tests/e2e/graph.spec.ts`

**Interfaces:**
- Consumes: Task 5 helpers.
- Produces:
  - `GraphUi.lod: Lod` (replaces `GraphUi.zoomLevel`); `GraphUi.zoomToLoop(loopId: string): void` (Task 7 fills it).
  - `PromiseGraph` renders `<div className="canvas-stage">` with the axis, the column and the canvas; the graph group keeps `role="group"`, its name and `data-ready`, and has `data-zoom`.
  - `LaneColumn({ layout, viewport })`, `TimeAxis({ context, T, viewport, width })`.
  - Exported `ACT_NODE_SIZE = 28`.

- [ ] **Step 1: Write the failing e2e tests** (replace the test `wheel and pinch both zoom the time axis`, and append the others)

```ts
const graph = (page: Page) => page.getByRole('group', { name: /promise graph for/i });
const zoomOf = async (page: Page) => Number(await graph(page).getAttribute('data-zoom'));
const boxOf = async (locator: Locator) => (await locator.boundingBox())!;

test('the canvas opens at 100 %, zooms with Ctrl + wheel and pinch, and moves with the wheel and a drag', async ({ page }) => {
  await signIn(page);
  expect(await zoomOf(page)).toBe(1);
  const box = await boxOf(graph(page));
  const first = branches(page).first();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await boxOf(first);
  await page.mouse.wheel(0, 200);
  await expect.poll(async () => (await boxOf(first)).y).toBeLessThan(before.y);
  expect(await zoomOf(page)).toBe(1);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(1);
  const zoomed = await zoomOf(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', spread: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: x - spread, y, id: 1 }, { x: x + spread, y, id: 2 }],
    });
  await touch('touchStart', 40);
  for (const spread of [60, 90, 120]) await touch('touchMove', spread);
  await touch('touchEnd', 0);
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(zoomed);
  // Ctrl + wheel inside the canvas zooms the canvas, never the browser page.
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
});

test('a drag on empty canvas moves the canvas, and the lane names stay in their column and bands', async ({ page }) => {
  await signIn(page);
  const name = page.getByTestId('lane-column').getByText('Engineering', { exact: true });
  const nameBefore = await boxOf(name);
  const first = branches(page).first();
  const before = await boxOf(first);
  const box = await boxOf(graph(page));
  await page.mouse.move(box.x + box.width - 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 340, box.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await boxOf(first)).x).toBeLessThan(before.x - 200);
  expect((await boxOf(name)).x).toBe(nameBefore.x);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  const band = page.getByTestId('lane-column').locator('[data-lane]').filter({ hasText: 'Engineering' });
  await expect.poll(async () => (await boxOf(band)).height).toBeGreaterThan(nameBefore.height);
});

test('titles show from 60 % and labels from 80 %; the axis labels days only when they fit', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('text.br-title').first()).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pg:set-zoom', { detail: 0.5 })));
  await expect(page.locator('text.br-title').first()).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pg:set-zoom', { detail: 0.1 })));
  await expect(page.getByTestId('time-axis').getByText(/^\d{1,2} \w+$/)).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pg:set-zoom', { detail: 4 })));
  await expect(page.getByTestId('time-axis').getByText(/^\d{1,2} \w+$/).first()).toBeVisible();
});
```

The `pg:set-zoom` event is a test hook that Task 7 replaces with the % menu; add it in Step 5 and remove it in Task 7 Step 6. Add `type Locator` to the Playwright import.

- [ ] **Step 2: Run them and see them fail**

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts -g "canvas|lane names|titles show" > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 1; `data-zoom` is null.

- [ ] **Step 3: Fix the base scale in `GraphScreen`**

In `src/components/graph/GraphScreen.tsx`:

1. Delete `ZOOM_PX`, `zoomLevelOf`, the `days` memo, `fit`, `onWidth`, the `width` and `pxPerDay` states, `scalePx` and `onZoomChoice`.
2. Build the layout at the base scale:

```ts
  const layout = useMemo(
    () =>
      layoutPromiseGraph(
        { ...engine, loops: visibleLoops },
        { context },
        { pxPerDay: BASE_PX_PER_DAY, rowHeight: BASE_ROW_HEIGHT },
      ),
    [engine, visibleLoops, context],
  );
```

(Tasks 11 and 12 later rename this memo `baseLayout`; they keep these options.)
3. Remove `pxPerDay`, `onWidth` and `onZoom` from `<PromiseGraph`, and `zoomLevel`, `onZoom` from `<FilterBar`.
4. Move `<Legend />` from below the stage into `PromiseGraph` (Step 5), so it shows in full screen.

In `src/components/graph/FilterBar.tsx`, delete the zoom `Segmented` block and the `zoomLevel` and `onZoom` props, and the `ZoomChoice` type if nothing else uses it.

- [ ] **Step 4: Create the frozen parts**

Create `src/components/graph/LaneColumn.tsx`:

```tsx
import type { GraphLayout } from '../../contracts/layout';
import type { Viewport } from '../../lib/graph-layout';

const MIN_BAND = 14;

/** Outside the React Flow viewport: it follows the vertical pan and the zoom, never the sideways pan. */
export function LaneColumn({ layout, viewport }: { layout: GraphLayout; viewport: Viewport }) {
  return (
    <div className="lane-col" data-testid="lane-column">
      {layout.lanes.map((lane) => {
        const height = lane.height * viewport.zoom;
        return (
          <span
            key={lane.id}
            data-lane={lane.departmentId}
            className={lane.order % 2 ? 'odd' : undefined}
            style={{ top: viewport.y + lane.y * viewport.zoom, height }}
          >
            {height >= MIN_BAND ? lane.name : ''}
          </span>
        );
      })}
      <span className="side" style={{ top: viewport.y + layout.trunkY * viewport.zoom - 10, height: 20 }}>
        Vendor ↑ · Client ↓
      </span>
    </div>
  );
}
```

Create `src/components/graph/TimeAxis.tsx`:

```tsx
import type { GraphContext } from '../../contracts/graph';
import { BASE_PX_PER_DAY, createTimeScale, tickStep, type Viewport } from '../../lib/graph-layout';

const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });

export function TimeAxis({
  context,
  T,
  viewport,
  width,
}: {
  context: GraphContext;
  T: string;
  viewport: Viewport;
  width: number;
}) {
  const scale = createTimeScale(context, BASE_PX_PER_DAY);
  const step = tickStep(BASE_PX_PER_DAY * viewport.zoom);
  const ticks: { x: number; text: string; month: boolean }[] = [];
  for (let date = context.windowStart; date <= context.windowEnd; ) {
    const x = viewport.x + (scale.dateEndX(date) - BASE_PX_PER_DAY) * viewport.zoom;
    const month = date.endsWith('-01'),
      monday = new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
    if (x > -80 && x < width + 10 && (month || step === 'day' || (step === 'week' && monday)))
      ticks.push({ x, text: month ? monthLabel(date) : dayLabel(date), month });
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }
  const xT = viewport.x + scale.x(T) * viewport.zoom;
  return (
    <svg className="time-axis" data-testid="time-axis" width={width} height={28} aria-hidden="true">
      {ticks.map((tick) => (
        <g key={tick.x}>
          <line x1={tick.x} y1={tick.month ? 0 : 16} x2={tick.x} y2={28} stroke="var(--rule)" />
          <text x={tick.x + 4} y={18} fontSize="11" fontWeight={tick.month ? 700 : 400}>
            {tick.text}
          </text>
        </g>
      ))}
      <rect x={xT - 30} y={4} width={60} height={18} rx={4} fill="var(--ink)" />
      <text x={xT} y={17} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--surface)">
        T
      </text>
    </svg>
  );
}
```

- [ ] **Step 5: Turn `PromiseGraph` into the canvas**

In `src/components/graph/PromiseGraph.tsx`:

1. Set `export const GRAPH_LEFT = 0;` (the column is outside the canvas) and keep `GRAPH_RIGHT`.
2. Remove the props `pxPerDay`, `onWidth`, `onZoom` and `revealX`. Keep the rest.
3. Delete the state `x`, `pendingX`, `lastPx`, the `clampX` callback, the effects for zoom anchoring, `revealX`, wheel and pinch, and the `reveal` callback.
4. Add, inside `Graph`:

```ts
  const flow = useReactFlow();
  const viewport = useViewport();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const lod = lodOf(viewport.zoom);
  const content = useMemo(
    () => ({ x0: -CURVE, x1: layout.width + GRAPH_RIGHT, y0: 0, y1: layout.height }),
    [layout],
  );
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // SRD 7.2 (14 Oct 2026): the first view is 100 % with T at 80 % of the width and the trunk at the centre.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || size.width === 0) return;
    placed.current = true;
    const xT = createTimeScale(context, BASE_PX_PER_DAY).x(T);
    void flow.setViewport({ x: size.width * 0.8 - xT, y: size.height / 2 - layout.trunkY, zoom: 1 });
  }, [size, flow, context, T, layout.trunkY]);
  const reveal = useCallback(
    (key: string) => {
      const at = xOfKey(key);
      if (at === undefined) return;
      void flow.setCenter(at, layout.trunkY, { zoom: viewport.zoom, duration: 200 });
    },
    [xOfKey, flow, layout.trunkY, viewport.zoom],
  );
  // A test hook until the % menu exists (Task 7 removes it).
  useEffect(() => {
    const onZoom = (event: Event) =>
      void flow.zoomTo((event as CustomEvent<number>).detail, { duration: 0 });
    window.addEventListener('pg:set-zoom', onZoom);
    return () => window.removeEventListener('pg:set-zoom', onZoom);
  }, [flow]);
```

   Import `useReactFlow`, `useViewport` from `@xyflow/react`; `BASE_PX_PER_DAY`, `lodOf`, `MIN_ZOOM`, `MAX_ZOOM`, `CURVE` from `../../lib/graph-layout`; `LaneColumn`, `TimeAxis`, `Legend`.
5. In the `ui` memo, replace `zoomLevel: layout.zoomLevel,` with `lod,` and add `zoomToLoop: () => undefined,` (Task 7 fills it). Update the dependency list.
6. Replace the returned JSX with:

```tsx
  return (
    <GraphUiContext.Provider value={ui}>
      <div className={`canvas-stage lod-${lod}`}>
        <div className="canvas-corner">Departments</div>
        <div className="canvas-axis">
          <TimeAxis context={context} T={T} viewport={viewport} width={size.width} />
        </div>
        <LaneColumn layout={layout} viewport={viewport} />
        <div
          ref={wrapRef}
          className="gwrap"
          role="group"
          aria-label={`Promise graph for ${props.title}`}
          data-zoom={viewport.zoom.toFixed(2)}
          data-ready={size.width > 0 ? 'true' : undefined}
        >
          <ReactFlow<GraphNode, BranchEdgeType>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            translateExtent={[
              [content.x0 - 400, content.y0 - 400],
              [content.x1 + 400, content.y1 + 400],
            ]}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            disableKeyboardA11y
            panOnDrag
            panOnScroll
            panOnScrollMode={PanOnScrollMode.Free}
            zoomOnScroll={false}
            zoomOnPinch
            zoomActivationKeyCode={['Meta', 'Control']}
            zoomOnDoubleClick={false}
            preventScrolling
            proOptions={{ hideAttribution: true }}
          >
            <ViewportPortal>
              <Backdrop layout={layout} context={context} T={T} contentWidth={content.x1} pxPerDay={BASE_PX_PER_DAY} />
            </ViewportPortal>
          </ReactFlow>
        </div>
        <Legend />
      </div>
    </GraphUiContext.Provider>
  );
```

   Import `PanOnScrollMode` from `@xyflow/react`. In `Backdrop`, remove the "Vendor" and "Client" texts, the separator line and the month labels (the axis draws them); keep the lane stripes, the month lines, the T line, the trunk and the slip arrow marker.
7. In the act and milestone node building, use `GRAPH_LEFT` as before (now 0).

In `src/components/graph/ui-context.ts`, replace `zoomLevel: GraphLayout['zoomLevel'];` with `lod: Lod;` (import `type Lod` from `../../lib/graph-layout`) and add `zoomToLoop(loopId: string): void;`.

In `ActNode.tsx`, delete the `{ui.zoomLevel === 'detail' && (<text ...>{glyph.label}</text>)}` block; Task 11 draws act labels in `BranchEdge`. In `BranchEdge.tsx`: delete `if (!data || ui.zoomLevel === 'milestones') return null;` and keep `if (!data) return null;`; draw the branch title when `ui.lod >= 1` with `className="br-title"`; change the hit-dot radius from 9 to 14. In `ActNode.tsx`: set `ACT_NODE_SIZE = 28` and pass `r={7}` to `<Glyph>` (the default is 5 for the old 22 px node). In `MilestoneNode.tsx`: give the name `<text>` the class `ms-name` (hidden under 60 % by the CSS below), and change the counts line condition from `ui.zoomLevel === 'milestones'` to `ui.lod === 0`, so the overview still shows "3 open, ✕ 2 broken" when the names are hidden.

In `LaneLabel.tsx`: render only the two handles (no name), as below:

```tsx
import { Handle, Position, type Node } from '@xyflow/react';

export type LaneLabelNode = Node<{ name: string }, 'laneLabel'>;

/** Branch edges attach here only to satisfy React Flow; LaneColumn shows the names. */
export function LaneLabel() {
  return (
    <div style={{ height: 16 }}>
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0 }} />
    </div>
  );
}
```

In `GraphScreen.tsx`, where it used `revealX` to bring a selected loop into view, pass nothing: `PromiseGraph` reveals a selected loop itself with `reveal(loopKey(selectedLoopId))` in an effect on `selectedLoopId`.

- [ ] **Step 6: Styles** (in `src/app/globals.css`; replace the `.gwrap` block)

```css
  .canvas-stage {
    position: relative;
    height: calc(100dvh - var(--graph-top, 220px));
    min-height: 480px;
    border: 1px solid var(--rule);
    border-radius: 6px;
    background: var(--surface);
    overflow: hidden;
  }
  .canvas-corner {
    position: absolute;
    left: 0;
    top: 0;
    width: 120px;
    height: 28px;
    z-index: 4;
    padding: 6px 12px;
    font-size: 11px;
    font-weight: 700;
    color: var(--ink-3);
    background: var(--surface);
    border-right: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
  }
  .canvas-axis {
    position: absolute;
    left: 120px;
    right: 0;
    top: 0;
    height: 28px;
    z-index: 3;
    background: var(--surface);
    border-bottom: 1px solid var(--rule);
    overflow: hidden;
  }
  .time-axis text {
    fill: var(--ink-3);
  }
  .gwrap {
    position: absolute;
    left: 120px;
    top: 28px;
    right: 0;
    bottom: 0;
  }
  .lane-col {
    position: absolute;
    left: 0;
    top: 28px;
    bottom: 0;
    width: 120px;
    z-index: 3;
    background: var(--surface);
    border-right: 1px solid var(--rule);
    overflow: hidden;
  }
  .lane-col > span {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    padding-left: 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .lane-col > .odd {
    background: color-mix(in srgb, var(--panel) 55%, var(--surface));
  }
  .lane-col > .side {
    font-size: 11px;
    font-weight: 700;
    color: var(--ink-3);
  }
  .canvas-stage .legend {
    position: absolute;
    left: 132px;
    bottom: 8px;
    z-index: 5;
    padding: 4px 10px;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 6px;
  }
  .lod-0 .br-title,
  .lod-0 .ms-name {
    display: none;
  }
```

Set `--graph-top` on `.screen` of the graph page to the height of the header and filter bar (measure in the browser; start with `220px`).

- [ ] **Step 7: Update the SRD**

In `docs/superpowers/specs/2026-10-12-promise-graph-srd.md` section 7.2, replace the default-view sentence with: "The graph is a canvas panel: the wheel scrolls, Ctrl/Cmd + wheel or pinch zooms around the pointer (10 %–400 %), a drag on empty canvas moves it, and floating controls give zoom steps, a % menu, fit, a minimap and full screen. The first view is 100 % with T at 80 % of the width. Text shows from 60 % (titles) and 80 % (labels)."

- [ ] **Step 8: Run the graph e2e tests**

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 0. Older tests that used the zoom segmented control or `data-px-per-day` (the Task 1 and later tests in this plan do not) must use `data-zoom` and the `pg:set-zoom` hook; fix each one the run names.

- [ ] **Step 9: Commit**

```bash
npx pnpm@11.25.0 format
git add src docs tests/e2e/graph.spec.ts
git commit -m "feat: graph canvas with Miro-style zoom, frozen axis and lane column"
```

---

### Task 7: Canvas controls, % menu and zoom to a loop

**Files:**
- Create: `src/components/graph/CanvasControls.tsx`
- Modify: `src/components/graph/PromiseGraph.tsx`, `BranchEdge.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/e2e/graph.spec.ts`

**Interfaces:**
- Consumes: Task 5 helpers; Task 6 `size`, `content`, `flow`, `viewport`.
- Produces: `CanvasControls({ zoom, onStep, onPreset, minimap, onMinimap, fullscreen, fullscreenEnabled, onFullscreen })` with `type Preset = 'project' | 'week' | 'month' | 0.5 | 1 | 2`; `GraphUi.zoomToLoop` implemented.

- [ ] **Step 1: Write the failing e2e tests** (append)

```ts
const controls = (page: Page) => page.getByRole('toolbar', { name: 'Canvas controls' });

test('the controls step the zoom, and the % menu applies presets', async ({ page }) => {
  await signIn(page);
  await controls(page).getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => zoomOf(page)).toBe(1.25);
  await controls(page).getByRole('button', { name: 'Zoom out' }).click();
  await controls(page).getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(() => zoomOf(page)).toBe(0.75);
  await controls(page).getByRole('button', { name: 'Zoom level' }).click();
  await page.getByRole('menuitem', { name: '200%' }).click();
  await expect.poll(() => zoomOf(page)).toBe(2);
  await controls(page).getByRole('button', { name: 'Zoom level' }).click();
  await page.getByRole('menuitem', { name: 'Fit the project' }).click();
  await expect.poll(() => zoomOf(page)).toBeLessThan(1);
  await expect(page.getByRole('menu')).toBeHidden();
});

test('a double-click on a branch zooms to that loop at 150 % at most', async ({ page }) => {
  await signIn(page);
  await controls(page).getByRole('button', { name: 'Fit the project' }).click();
  const branch = page.getByRole('button', { name: /^Loop: Client secret renewal/ });
  await branch.locator('.hit').dispatchEvent('dblclick');
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(0.6);
  expect(await zoomOf(page)).toBeLessThanOrEqual(1.5);
  const area = await boxOf(graph(page));
  const b = await boxOf(branch.locator('.hit'));
  expect(b.x).toBeGreaterThanOrEqual(area.x);
  expect(b.x + b.width).toBeLessThanOrEqual(area.x + area.width);
  await expect(loopPanel(page)).toBeHidden();
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts -g "controls step|double-click" > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 1; no toolbar.

- [ ] **Step 3: Create the controls**

Create `src/components/graph/CanvasControls.tsx`:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';

export type Preset = 'project' | 'week' | 'month' | 0.5 | 1 | 2;
const PRESETS: readonly (readonly [Preset, string] | null)[] = [
  ['project', 'Fit the project'],
  ['week', 'Fit this week'],
  ['month', 'Fit this month'],
  null,
  [0.5, '50%'],
  [1, '100%'],
  [2, '200%'],
];
const Icon = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export function CanvasControls({
  zoom,
  onStep,
  onPreset,
  minimap,
  onMinimap,
  fullscreen,
  fullscreenEnabled,
  onFullscreen,
}: {
  zoom: number;
  onStep(direction: 1 | -1): void;
  onPreset(preset: Preset): void;
  minimap: boolean;
  onMinimap(): void;
  fullscreen: boolean;
  fullscreenEnabled: boolean;
  onFullscreen(): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof PointerEvent && root.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div ref={root} className="canvas-controls-wrap">
      {open && (
        <div className="canvas-menu" role="menu" aria-label="Zoom presets">
          {PRESETS.map((item, index) =>
            item === null ? (
              <hr key={index} />
            ) : (
              <button
                key={item[1]}
                type="button"
                role="menuitem"
                onClick={() => {
                  onPreset(item[0]);
                  setOpen(false);
                }}
              >
                {item[1]}
              </button>
            ),
          )}
        </div>
      )}
      <div className="canvas-controls" role="toolbar" aria-label="Canvas controls">
        <button type="button" aria-label="Zoom out" onClick={() => onStep(-1)}>
          <Icon d="M5 12h14" />
        </button>
        <button
          type="button"
          className="pct"
          aria-label="Zoom level"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => onStep(1)}>
          <Icon d="M12 5v14M5 12h14" />
        </button>
        <span className="sep" aria-hidden="true" />
        <button type="button" aria-label="Fit the project" onClick={() => onPreset('project')}>
          <Icon d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
        </button>
        <button type="button" aria-label="Minimap" aria-pressed={minimap} onClick={onMinimap}>
          <Icon d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM12 12h6v5h-6z" />
        </button>
        {fullscreenEnabled && (
          <button
            type="button"
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            onClick={onFullscreen}
          >
            <Icon d={fullscreen ? 'm14 10 7-7M20 10h-6V4M3 21l7-7M4 14h6v6' : 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7'} />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the controls and zoom to a loop in `PromiseGraph`**

Add inside `Graph`:

```ts
  const applyPreset = useCallback(
    (preset: Preset) => {
      const scale = createTimeScale(context, BASE_PX_PER_DAY),
        xT = scale.x(T);
      const view =
        preset === 'project'
          ? fitViewport(content, size)
          : preset === 'week'
            ? fitWidth(xT - 4 * BASE_PX_PER_DAY, xT + 3 * BASE_PX_PER_DAY, layout.trunkY, size)
            : preset === 'month'
              ? fitWidth(xT - 25 * BASE_PX_PER_DAY, xT + 5 * BASE_PX_PER_DAY, layout.trunkY, size)
              : zoomAround(viewport, preset, { x: size.width / 2, y: size.height / 2 });
      void flow.setViewport(view, { duration: 200 });
    },
    [context, T, content, size, layout.trunkY, viewport, flow],
  );
  const step = useCallback(
    (direction: 1 | -1) =>
      void flow.setViewport(
        zoomAround(viewport, nextZoom(viewport.zoom, direction), {
          x: size.width / 2,
          y: size.height / 2,
        }),
        { duration: 150 },
      ),
    [flow, viewport, size],
  );
  // Zoom to a loop stops at 150 %, so its text stays a normal reading size.
  const zoomToLoop = useCallback(
    (loopId: string) => {
      const branch = layout.branches.find((item) => item.loopId === loopId);
      if (!branch) return;
      const box = {
        x0: branch.xStart - CURVE,
        x1: branch.xEnd + CURVE,
        y0: Math.min(branch.y, layout.trunkY) - 30,
        y1: Math.max(branch.y, layout.trunkY) + 30,
      };
      void flow.setViewport(fitViewport(box, size, 48, 1.5), { duration: 200 });
    },
    [layout, size, flow],
  );
```

The Linear tickets plan later changes `layout.trunkY` here to `branch.forkY`, so a ticket's box reaches its parent's line.

Put `zoomToLoop` into the `ui` memo instead of the placeholder from Task 6, delete the `pg:set-zoom` test hook, and render, after `<Legend />`:

```tsx
        <CanvasControls
          zoom={viewport.zoom}
          onStep={step}
          onPreset={applyPreset}
          minimap={minimap}
          onMinimap={() => setMinimap((value) => !value)}
          fullscreen={fullscreen}
          fullscreenEnabled={fullscreenEnabled}
          onFullscreen={toggleFullscreen}
        />
```

Task 8 defines `minimap`, `fullscreen`, `fullscreenEnabled` and `toggleFullscreen`. Until Task 8, define `const [minimap, setMinimap] = useState(false); const fullscreen = false, fullscreenEnabled = false; const toggleFullscreen = () => undefined;`.

In `BranchEdge.tsx`, on the `.br` group add `onDoubleClick={(event) => { event.stopPropagation(); ui.zoomToLoop(branch.loopId); }}`.

Replace the `pg:set-zoom` calls in the Task 6 test `titles show from 60 %`: for 0.5 use the % menu (`50%`); for 0.1 use two `Zoom out` clicks after `50%` (0.5 → 0.25 → 0.1); for 4 use the % menu (`200%`) and then two `Zoom in` clicks (2 → 3 → 4).

- [ ] **Step 5: Styles** (in `src/app/globals.css`)

```css
  .canvas-controls-wrap {
    position: absolute;
    right: 12px;
    bottom: 12px;
    z-index: 6;
  }
  .canvas-controls {
    display: flex;
    gap: 2px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 8px;
    box-shadow: var(--shadow);
  }
  .canvas-controls button,
  .canvas-menu button {
    all: unset;
    box-sizing: border-box;
    min-width: 32px;
    height: 30px;
    padding: 0 8px;
    border-radius: 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--ink);
  }
  .canvas-controls button:hover,
  .canvas-controls button[aria-pressed='true'],
  .canvas-menu button:hover {
    background: var(--sunk);
  }
  .canvas-controls button:focus-visible,
  .canvas-menu button:focus-visible {
    outline: 2px solid var(--focus);
  }
  .canvas-controls .pct {
    min-width: 64px;
    font-family: var(--f-id);
    font-weight: 600;
    font-size: 13px;
  }
  .canvas-controls .sep {
    width: 1px;
    margin: 4px 2px;
    background: var(--rule);
  }
  .canvas-menu {
    position: absolute;
    right: 0;
    bottom: 44px;
    min-width: 170px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 8px;
    box-shadow: var(--shadow);
  }
  .canvas-menu button {
    display: flex;
    width: 100%;
    justify-content: flex-start;
    font-size: 13px;
  }
  .canvas-menu hr {
    border: 0;
    border-top: 1px solid var(--rule);
    margin: 4px 0;
  }
```

- [ ] **Step 6: Run the tests**

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
npx pnpm@11.25.0 format
git add src/components/graph src/app/globals.css tests/e2e/graph.spec.ts
git commit -m "feat: canvas controls, zoom presets and zoom to a loop"
```

---

### Task 8: Minimap and full screen

**Files:**
- Create: `src/components/graph/Minimap.tsx`
- Modify: `src/components/graph/PromiseGraph.tsx`, `GraphScreen.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/e2e/graph.spec.ts`

**Interfaces:**
- Consumes: `minimapScale`, `minimapViewport` (Task 5); `CanvasControls` props (Task 7).
- Produces: `Minimap({ layout, content, viewport, canvas, onMove })`; the stage grid element `ref` passed to `PromiseGraph` as `stageRef: RefObject<HTMLDivElement | null>`.

- [ ] **Step 1: Write the failing e2e tests** (append)

```ts
test('the minimap shows the visible area and moves the canvas on a click', async ({ page }) => {
  await signIn(page);
  await controls(page).getByRole('button', { name: 'Minimap' }).click();
  const map = page.getByRole('img', { name: 'Minimap' });
  await expect(map).toBeVisible();
  const first = branches(page).first();
  const before = await boxOf(first);
  const m = await boxOf(map);
  await page.mouse.click(m.x + 6, m.y + m.height / 2);
  await expect.poll(async () => (await boxOf(first)).x).not.toBe(before.x);
  await controls(page).getByRole('button', { name: 'Minimap' }).click();
  await expect(map).toBeHidden();
});

test('full screen enters and exits from the controls', async ({ page }) => {
  await signIn(page);
  const enabled = await page.evaluate(() => document.fullscreenEnabled);
  const button = controls(page).getByRole('button', { name: /full screen/i });
  if (!enabled) {
    await expect(button).toHaveCount(0);
    return;
  }
  await button.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className ?? '')).toContain('stage');
  await expect(controls(page).getByRole('button', { name: 'Exit full screen' })).toBeVisible();
  await controls(page).getByRole('button', { name: 'Exit full screen' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts -g "minimap|full screen" > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 1.

- [ ] **Step 3: Create the minimap**

Create `src/components/graph/Minimap.tsx`:

```tsx
'use client';
import type { PointerEvent } from 'react';
import type { GraphLayout } from '../../contracts/layout';
import { minimapScale, minimapViewport, type Box, type Size, type Viewport } from '../../lib/graph-layout';
import { TONE_COLOR } from './labels';

const MAP: Size = { width: 220, height: 120 };

/** Drawn from the layout, because React Flow's MiniMap draws only nodes and the branches are edges. */
export function Minimap({
  layout,
  content,
  viewport,
  canvas,
  onMove,
}: {
  layout: GraphLayout;
  content: Box;
  viewport: Viewport;
  canvas: Size;
  onMove(view: Viewport): void;
}) {
  const scale = minimapScale(MAP, content);
  const ox = (MAP.width - (content.x1 - content.x0) * scale) / 2,
    oy = (MAP.height - (content.y1 - content.y0) * scale) / 2;
  const toView = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onMove(
      minimapViewport(
        { x: event.clientX - box.left, y: event.clientY - box.top },
        MAP,
        content,
        canvas,
        viewport.zoom,
      ),
    );
  };
  return (
    <svg
      className="minimap"
      role="img"
      aria-label="Minimap"
      width={MAP.width}
      height={MAP.height}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        toView(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) toView(event);
      }}
    >
      <g transform={`translate(${ox - content.x0 * scale} ${oy - content.y0 * scale}) scale(${scale})`}>
        {layout.lanes.map((lane) => (
          <rect
            key={lane.id}
            x={content.x0}
            y={lane.y}
            width={content.x1 - content.x0}
            height={lane.height}
            fill={lane.order % 2 ? 'var(--panel)' : 'transparent'}
          />
        ))}
        <line x1={content.x0} y1={layout.trunkY} x2={content.x1} y2={layout.trunkY} stroke="var(--trunk)" strokeWidth={6} />
        {layout.branches.map((branch) => (
          <line
            key={branch.id}
            x1={branch.xStart}
            y1={branch.y}
            x2={branch.xEnd}
            y2={branch.y}
            stroke={TONE_COLOR[branch.tone]}
            strokeWidth={8}
          />
        ))}
      </g>
      <rect
        className="view"
        x={ox + (-viewport.x / viewport.zoom - content.x0) * scale}
        y={oy + (-viewport.y / viewport.zoom - content.y0) * scale}
        width={(canvas.width / viewport.zoom) * scale}
        height={(canvas.height / viewport.zoom) * scale}
        rx={3}
      />
    </svg>
  );
}
```

- [ ] **Step 4: Wire the minimap and full screen**

In `src/components/graph/GraphScreen.tsx`, add `const stageRef = useRef<HTMLDivElement>(null);`, put `ref={stageRef}` on the `<div className={\`stage${panelOpen ? ' open' : ''}\`}>` element (the grid with the graph and the loop panel), and pass `stageRef={stageRef}` to `<PromiseGraph`.

In `src/components/graph/PromiseGraph.tsx`, add the prop `stageRef: RefObject<HTMLDivElement | null>;` and replace the Task 7 placeholders with:

```ts
  const [minimap, setMinimap] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenEnabled, setFullscreenEnabled] = useState(false);
  useEffect(() => {
    // iPhone Safari has no element full screen; the button then stays hidden.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFullscreenEnabled(document.fullscreenEnabled === true);
    const onChange = () => setFullscreen(document.fullscreenElement === props.stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [props.stageRef]);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void props.stageRef.current?.requestFullscreen().catch(() => undefined);
  }, [props.stageRef]);
```

Render, before `<CanvasControls`:

```tsx
        {minimap && size.width > 0 && (
          <Minimap
            layout={layout}
            content={content}
            viewport={viewport}
            canvas={size}
            onMove={(view) => void flow.setViewport(view)}
          />
        )}
```

- [ ] **Step 5: Styles** (in `src/app/globals.css`)

```css
  .minimap {
    position: absolute;
    right: 12px;
    bottom: 56px;
    z-index: 5;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 8px;
    box-shadow: var(--shadow);
    cursor: pointer;
  }
  .minimap .view {
    fill: color-mix(in srgb, var(--route) 12%, transparent);
    stroke: var(--route);
    stroke-width: 1.5;
  }
  .stage:fullscreen {
    background: var(--panel);
    padding: 8px;
  }
  .stage:fullscreen .canvas-stage {
    height: calc(100dvh - 16px);
  }
```

- [ ] **Step 6: Run the tests**

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 0, including the phone-width test.

- [ ] **Step 7: Commit**

```bash
npx pnpm@11.25.0 format
git add src/components/graph src/app/globals.css tests/e2e/graph.spec.ts
git commit -m "feat: graph minimap and full screen"
```

---

### Task 9: Message sources in the graph view, source app and link rule

**Files:**
- Modify: `src/contracts/views.ts`
- Modify: `src/server/domain/graph/read.ts` (`getGraphView`)
- Create: `src/lib/source-app.ts`
- Create: `src/components/graph/source-link.ts`
- Modify: `src/app/(app)/projects/[id]/graph/page.tsx` (pass `sources`)
- Modify: `src/components/graph/GraphScreen.tsx` (add the `sources` prop type only)
- Test: `tests/integration/graph/read.test.ts`, `tests/unit/graph/source-app.test.ts`, `tests/unit/graph/source-link.test.ts`

**Interfaces:**
- Consumes: `loadCitationSources(db, projectId, versionIds)` from `src/server/domain/records/metadata.ts` (already used by `getLoop`).
- Produces:
  - `GraphSourceSchema`, `type GraphSource = { source: SourceKind; sourceLabel: string; permalink: string | null }`
  - `GraphView.sources: Record<string, GraphSource>` (key: record version ID)
  - `type SourceApp = 'slack' | 'gmail' | 'linear' | 'agent' | 'paste'`, `SOURCE_APP_NAME: Record<SourceApp, string>`
  - `sourceApp(source: SourceKind, permalink: string | null): SourceApp`
  - `linkablePermalink(source: SourceKind, permalink: string | null): string | null`
  - `type SourceLink = { href: string; text: string; external: boolean }`
  - `type ActSource = { app: SourceApp | null; label: string | null; link: SourceLink }`
  - `sourceLink(projectId: string, recordVersionId: string, source: GraphSource | undefined): SourceLink`
  - `actSource(projectId: string, recordVersionId: string, source: GraphSource | undefined): ActSource`
  - `GraphScreenProps.sources: Record<string, GraphSource>`

- [ ] **Step 1: Write the failing integration tests** (in `tests/integration/graph/read.test.ts`)

Add a new test after `historical commit view uses its own pinned context and the explicit T`:

```ts
  it('graph view names the source of every cited record version', async () => {
    const view = await getGraphView(t.db, ctx, { projectId, view: { kind: 'main' }, T });
    const cited = new Set(view.snapshot.acts.map((act) => act.citation.recordVersionId));
    expect(new Set(Object.keys(view.sources))).toEqual(cited);
    expect(view.sources[citedVersionId]).toMatchObject({
      source: expect.stringMatching(/^(paste|agent|slack|gmail)$/),
      sourceLabel: expect.any(String),
    });
    expect(GraphViewSchema.parse(view)).toEqual(view);
  });
```

In the test `withdrawn text is masked in every view including old commits`, add inside the `for` loop, after the `expect(act)...` line:

```ts
      expect(graph.sources[citedVersionId].permalink).toBeNull();
      expect(graph.sources[citedVersionId].sourceLabel.length).toBeGreaterThan(0);
```

- [ ] **Step 2: Write the failing unit tests**

Create `tests/unit/graph/source-app.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { linkablePermalink, sourceApp } from '../../../src/lib/source-app';

describe('sourceApp and linkablePermalink', () => {
  it('trusts native Slack and Gmail sources', () => {
    expect(sourceApp('slack', null)).toBe('slack');
    expect(sourceApp('gmail', 'https://mail.google.com/mail/u/0/#all/a')).toBe('gmail');
    expect(linkablePermalink('slack', 'https://x.slack.com/archives/C1/p1')).toBe(
      'https://x.slack.com/archives/C1/p1',
    );
  });
  it('recognises agent and pasted records by permalink domain', () => {
    const cases = [
      ['https://acme.slack.com/archives/C1/p1', 'slack'],
      ['https://slack.com/archives/C1/p1', 'slack'],
      ['https://mail.google.com/mail/u/0/#inbox/abc', 'gmail'],
      ['https://linear.app/acme/issue/PG-112/sync-crm', 'linear'],
    ] as const;
    for (const [url, app] of cases)
      for (const source of ['agent', 'paste'] as const) {
        expect(sourceApp(source, url)).toBe(app);
        expect(linkablePermalink(source, url)).toBe(url);
      }
  });
  it('keeps look-alike hosts, http, credentials and other domains as plain text', () => {
    for (const url of [
      'https://slack.com.evil.example/x',
      'https://evilslack.com/x',
      'https://linear.app.example/x',
      'https://mail.google.com.example/x',
      'https://linear.app@evil.example/x',
      'https://user@linear.app/x',
      'https://linear.app:8443/x',
      'http://linear.app/x',
      'https://notion.example/x',
      'not a url',
    ]) {
      expect(sourceApp('agent', url)).toBe('agent');
      expect(linkablePermalink('agent', url)).toBeNull();
    }
    expect(linkablePermalink('slack', 'javascript:alert(1)')).toBeNull();
    expect(linkablePermalink('paste', null)).toBeNull();
    expect(sourceApp('paste', null)).toBe('paste');
  });
});
```

Create `tests/unit/graph/source-link.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { actSource, sourceLink } from '../../../src/components/graph/source-link';

const P = '11111111-1111-4111-8111-111111111111',
  V = '22222222-2222-4222-8222-222222222222';
const record = `/projects/${P}/records/${V}`;

describe('sourceLink', () => {
  it('opens a linkable permalink in a new tab, named after its app', () => {
    expect(
      sourceLink(P, V, {
        source: 'agent',
        sourceLabel: 'PG team',
        permalink: 'https://linear.app/acme/issue/PG-112/x',
      }),
    ).toEqual({ href: 'https://linear.app/acme/issue/PG-112/x', text: 'Open in Linear', external: true });
    expect(
      sourceLink(P, V, { source: 'slack', sourceLabel: '#ops', permalink: 'https://x.slack.com/a' })
        .text,
    ).toBe('Open in Slack');
  });
  it('links to the record for any other permalink or a missing source', () => {
    expect(
      sourceLink(P, V, { source: 'agent', sourceLabel: 'Notes', permalink: 'https://notion.example/x' }),
    ).toEqual({ href: record, text: 'View record', external: false });
    expect(sourceLink(P, V, undefined).href).toBe(record);
  });
});

describe('actSource', () => {
  it('gives the app and the source label', () => {
    expect(
      actSource(P, V, { source: 'agent', sourceLabel: '#larkspur-it', permalink: 'https://a.slack.com/x' }),
    ).toMatchObject({ app: 'slack', label: '#larkspur-it' });
    expect(actSource(P, V, undefined)).toMatchObject({ app: null, label: null });
  });
});
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `npx pnpm@11.25.0 exec vitest run tests/integration/graph/read.test.ts tests/unit/graph > /tmp/unit.log 2>&1; echo $?`
Expected: exit 1. The integration test reads `sources` of undefined; the unit tests cannot resolve `source-app` and `source-link`.

- [ ] **Step 4: Extend the contract**

In `src/contracts/views.ts`, add `import { PermalinkSchema, SourceKindSchema } from './records';` and:

```ts
/** Where a cited record version came from. The browser decides which permalinks are links. */
export const GraphSourceSchema = z.strictObject({
  source: SourceKindSchema,
  sourceLabel: z.string().min(1).max(200),
  permalink: PermalinkSchema.nullable(),
});
```

Add `sources: z.record(IdSchema, GraphSourceSchema),` as the last field of `GraphViewSchema`, and `export type GraphSource = z.infer<typeof GraphSourceSchema>;` at the end of the file.

- [ ] **Step 5: Fill the field on the server**

In `src/server/domain/graph/read.ts`, inside `getGraphView`, before the `return {`:

```ts
    const cited = await loadCitationSources(
      tx,
      project.id,
      snapshot.acts.map((act) => act.citation.recordVersionId),
    );
```

and add as the last returned field:

```ts
      sources: Object.fromEntries(
        [...cited].map(([id, item]) => [
          id,
          { source: item.source, sourceLabel: item.sourceLabel, permalink: item.permalink },
        ]),
      ),
```

- [ ] **Step 6: Create the source-app rule**

Create `src/lib/source-app.ts`:

```ts
import type { SourceKind } from '../contracts/records';

export type SourceApp = 'slack' | 'gmail' | 'linear' | 'agent' | 'paste';
export const SOURCE_APP_NAME: Record<SourceApp, string> = {
  slack: 'Slack',
  gmail: 'Gmail',
  linear: 'Linear',
  agent: 'Agent',
  paste: 'Paste',
};

function hostApp(permalink: string | null): 'slack' | 'gmail' | 'linear' | null {
  if (!permalink) return null;
  let url: URL;
  try {
    url = new URL(permalink);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'slack.com' || host.endsWith('.slack.com')) return 'slack';
  if (host === 'mail.google.com') return 'gmail';
  if (host === 'linear.app') return 'linear';
  return null;
}

/** Native connector sources name their app; for agent and pasted records only the permalink domain can. */
export function sourceApp(source: SourceKind, permalink: string | null): SourceApp {
  if (source === 'slack' || source === 'gmail') return source;
  return hostApp(permalink) ?? source;
}

// Owner decision of 14 Oct 2026: links to these three domains open; any other agent or pasted URL stays plain text, so an import cannot plant a phishing link.
export function linkablePermalink(source: SourceKind, permalink: string | null): string | null {
  if (!permalink) return null;
  if (source === 'slack' || source === 'gmail') return permalink.startsWith('https://') ? permalink : null;
  return hostApp(permalink) ? permalink : null;
}
```

- [ ] **Step 7: Create the link helper**

Create `src/components/graph/source-link.ts`:

```ts
import type { GraphSource } from '../../contracts/views';
import { SOURCE_APP_NAME, linkablePermalink, sourceApp, type SourceApp } from '../../lib/source-app';

export type SourceLink = { href: string; text: string; external: boolean };
export type ActSource = { app: SourceApp | null; label: string | null; link: SourceLink };

export function sourceLink(
  projectId: string,
  recordVersionId: string,
  source: GraphSource | undefined,
): SourceLink {
  const href = source ? linkablePermalink(source.source, source.permalink) : null;
  if (source && href)
    return {
      href,
      text: `Open in ${SOURCE_APP_NAME[sourceApp(source.source, source.permalink)]}`,
      external: true,
    };
  return {
    href: `/projects/${projectId}/records/${recordVersionId}`,
    text: 'View record',
    external: false,
  };
}

export function actSource(
  projectId: string,
  recordVersionId: string,
  source: GraphSource | undefined,
): ActSource {
  return {
    app: source ? sourceApp(source.source, source.permalink) : null,
    label: source?.sourceLabel ?? null,
    link: sourceLink(projectId, recordVersionId, source),
  };
}
```

- [ ] **Step 8: Pass the sources to the screen**

In `src/components/graph/GraphScreen.tsx`, add `import type { GraphSource } from '../../contracts/views';` and add `sources: Record<string, GraphSource>;` to `GraphScreenProps`. Do not destructure it yet, because lint rejects an unused variable. Task 10 destructures it.

In `src/app/(app)/projects/[id]/graph/page.tsx`, add `sources={view.sources}` to `<GraphScreen`.

- [ ] **Step 9: Run the tests and see them pass**

Run: `npx pnpm@11.25.0 exec vitest run tests/integration/graph tests/integration/adapters tests/unit/graph > /tmp/unit.log 2>&1; echo $?`
Expected: exit 0. The REST adapter tests also pass, because the route returns the extended `GraphView`.

Run: `npx pnpm@11.25.0 typecheck > /tmp/tsc.log 2>&1; echo $?`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
npx pnpm@11.25.0 format
git add src/contracts/views.ts src/server/domain/graph/read.ts src/lib/source-app.ts src/components/graph src/app tests
git commit -m "feat: graph view names the source app of every cited record version"
```

---

### Task 10: Source icons and an interactive hover card with source and link

**Files:**
- Create: `src/components/graph/SourceIcon.tsx`
- Create: `src/components/graph/ActCard.tsx`
- Modify: `src/components/graph/ui-context.ts`
- Modify: `src/components/graph/BranchEdge.tsx` (hit dots)
- Modify: `src/components/graph/PromiseGraph.tsx` (props, `ui`, hide on pan)
- Modify: `src/components/graph/GraphScreen.tsx` (tip state, card, Escape)
- Modify: `src/app/globals.css` (`.tip`)
- Test: `tests/e2e/graph.spec.ts`

**Interfaces:**
- Consumes: `actSource`, `ActSource`, `SourceApp`, `SOURCE_APP_NAME` (Task 9); `GraphScreenProps.sources` (Task 9).
- Produces:
  - `SourceIcon({ app, size, x, y }: { app: SourceApp; size: number; x?: number; y?: number })`, an `<svg role="img">` whose `<title>` is the app name. It works inside HTML and inside SVG.
  - `GraphUi.showAct(glyph: ActGlyph, anchor: Element): void`, `GraphUi.leaveAct(): void`, `GraphUi.actSource(actId: string): ActSource | null` (replace `hoverAct`)
  - `PromiseGraphProps.onShowAct(glyph: ActGlyph, anchor: Element): void`, `onLeaveAct(): void`, `onHideAct(): void`, `actSource(actId: string): ActSource | null` (replace `onHoverAct`)
  - `ActCard` with `role="dialog"`.

- [ ] **Step 1: Write the failing tests** (append to `tests/e2e/graph.spec.ts`)

```ts
const firstDot = (page: Page) =>
  page.getByRole('button', { name: /^Loop: Client secret renewal/ }).locator('circle.hit-dot').first();

test('the hover card names the message source and its link stays reachable', async ({ page }) => {
  await signIn(page);
  await firstDot(page).hover();
  const card = page.getByRole('dialog', { name: / by / });
  await expect(card).toContainText('#larkspur-it');
  await expect(card.getByRole('img', { name: 'Slack' })).toBeVisible();
  const link = card.getByRole('link', { name: 'Open in Slack' });
  await expect(link).toHaveAttribute('href', /^https:\/\//);
  await expect(link).toHaveAttribute('target', '_blank');
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height - 10, { steps: 4 });
  await page.waitForTimeout(400);
  await expect(card).toBeVisible();
});

test('Escape closes the hover card first and the loop panel second', async ({ page }) => {
  await signIn(page);
  await firstDot(page).click();
  await expect(loopPanel(page)).toBeVisible();
  await firstDot(page).hover();
  const card = page.getByRole('dialog', { name: / by / });
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(loopPanel(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(loopPanel(page)).toBeHidden();
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts -g "hover card|Escape closes" > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 1. No `dialog` role exists; the tooltip has `role="tooltip"`.

- [ ] **Step 3: Create the source icon**

Create `src/components/graph/SourceIcon.tsx`:

```tsx
import type { ReactNode } from 'react';
import { SOURCE_APP_NAME, type SourceApp } from '../../lib/source-app';

// Gmail and Linear marks: Simple Icons 16.32.0 (CC0). Slack, paste and agent: Lucide 1.48.0 (ISC).
// Simple Icons removed the Slack logo at Slack's request, so Slack shows its channel sign.
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;
const SHAPES: Record<SourceApp, ReactNode> = {
  slack: (
    <g {...STROKE} strokeWidth={2.4}>
      <line x1="4" x2="20" y1="9" y2="9" />
      <line x1="4" x2="20" y1="15" y2="15" />
      <line x1="10" x2="8" y1="3" y2="21" />
      <line x1="16" x2="14" y1="3" y2="21" />
    </g>
  ),
  gmail: (
    <path
      fill="currentColor"
      d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"
    />
  ),
  linear: (
    <path
      fill="currentColor"
      d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z"
    />
  ),
  paste: (
    <g {...STROKE}>
      <path d="M11 14h10" />
      <path d="M16 4h2a2 2 0 0 1 2 2v1.344" />
      <path d="m17 18 4-4-4-4" />
      <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
    </g>
  ),
  agent: (
    <g {...STROKE}>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </g>
  ),
};

export function SourceIcon({
  app,
  size,
  x,
  y,
}: {
  app: SourceApp;
  size: number;
  x?: number;
  y?: number;
}) {
  return (
    <svg
      className="src-icon"
      role="img"
      width={size}
      height={size}
      x={x}
      y={y}
      viewBox="0 0 24 24"
    >
      <title>{SOURCE_APP_NAME[app]}</title>
      {SHAPES[app]}
    </svg>
  );
}
```

- [ ] **Step 4: Create the card**

Create `src/components/graph/ActCard.tsx`:

```tsx
'use client';
import type { DerivedAct } from '../../contracts/engine';
import { ACT_LABEL, partyName, shortStamp, type Directory } from './labels';
import type { ActSource } from './source-link';
import { SourceIcon } from './SourceIcon';

export type CardAnchor = { x: number; y: number };

export function ActCard({
  act,
  loopTitle,
  anchor,
  source,
  directory,
  timeZone,
  onEnter,
  onLeave,
}: {
  act: DerivedAct;
  loopTitle: string;
  anchor: CardAnchor;
  source: ActSource | null;
  directory: Directory;
  timeZone: string;
  onEnter(): void;
  onLeave(): void;
}) {
  const actor = partyName(act.actor, directory);
  return (
    <div
      className="tip"
      role="dialog"
      aria-label={`${ACT_LABEL[act.type]} by ${actor}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        left: Math.min(
          anchor.x + 6,
          (typeof window === 'undefined' ? 1200 : window.innerWidth) - 310,
        ),
        top: anchor.y + 6,
      }}
    >
      <span className="tip-loop">{loopTitle}</span>
      <b>{ACT_LABEL[act.type]}</b>, {actor}
      <br />
      {shortStamp(act.occurredAt, timeZone)} {timeZone}
      {act.quote === null ? <q>Unavailable evidence</q> : <q>{act.quote.slice(0, 140)}</q>}
      {source && (
        <span className="tip-src">
          {source.app && source.label && (
            <>
              <SourceIcon app={source.app} size={14} />
              {source.label}
              <br />
            </>
          )}
          <a
            href={source.link.href}
            {...(source.link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {source.link.text}
            {source.link.external && <span aria-hidden="true"> ↗</span>}
          </a>
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Replace `hoverAct` in the UI context**

In `src/components/graph/ui-context.ts`, add `import type { ActSource } from './source-link';`, remove `type MouseEvent` from the React import, and replace the `hoverAct` line with:

```ts
  showAct(glyph: ActGlyph, anchor: Element): void;
  leaveAct(): void;
  actSource(actId: string): ActSource | null;
```

- [ ] **Step 6: Use it in `BranchEdge`**

In `src/components/graph/BranchEdge.tsx`, replace the three mouse handlers on the `hit-dot` circle with:

```tsx
            onMouseEnter={(event) => ui.showAct(glyph, event.currentTarget)}
            onMouseLeave={() => ui.leaveAct()}
```

- [ ] **Step 7: Change the `PromiseGraph` props and `ui`**

In `src/components/graph/PromiseGraph.tsx`:

1. In `PromiseGraphProps`, replace `onHoverAct(glyph: ActGlyph | null, event?: MouseEvent): void;` with:

```ts
  onShowAct(glyph: ActGlyph, anchor: Element): void;
  onLeaveAct(): void;
  onHideAct(): void;
  actSource(actId: string): ActSource | null;
```

2. Add `import type { ActSource } from './source-link';` and remove `type MouseEvent` from the React import if nothing else uses it.
3. In `Graph`, destructure `onShowAct, onLeaveAct, onHideAct, actSource` instead of `onHoverAct`.
4. In the `ui` memo, replace `hoverAct: onHoverAct,` with `showAct: onShowAct, leaveAct: onLeaveAct, actSource,` and replace `onHoverAct` in its dependency list with `onShowAct, onLeaveAct, actSource`.
5. After the viewport hooks from Task 6, add:

```ts
  // The card anchors to a dot's screen box, which a pan or a zoom moves.
  useEffect(() => onHideAct(), [viewport.x, viewport.y, viewport.zoom, onHideAct]);
```

- [ ] **Step 8: Own the card state in `GraphScreen`**

In `src/components/graph/GraphScreen.tsx`:

1. Add `sources` to the destructured props. Imports: add `import { ActCard, type CardAnchor } from './ActCard';` and `import { actSource as describeSource, type ActSource } from './source-link';`. Remove `type MouseEvent` from the React import and `ACT_LABEL`, `partyName`, `shortStamp` from the `./labels` import if nothing else uses them.
2. Replace `type Tip = { x: number; y: number; glyph: ActGlyph };` with `type Tip = { glyph: ActGlyph; anchor: CardAnchor };`.
3. Below `const [tip, setTip] = useState<Tip | null>(null);` add:

```ts
  const closeTimer = useRef<number | null>(null);
```

4. Replace the `onHoverAct` callback with:

```ts
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const showAct = useCallback(
    (glyph: ActGlyph, anchor: Element) => {
      cancelClose();
      const box = anchor.getBoundingClientRect();
      setTip({ glyph, anchor: { x: box.right, y: box.bottom } });
    },
    [cancelClose],
  );
  // A short delay lets the pointer travel from the dot into the card to reach its link.
  const leaveAct = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setTip(null), 200);
  }, [cancelClose]);
  const hideAct = useCallback(() => {
    cancelClose();
    setTip(null);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);
  const recordOfAct = useMemo(
    () =>
      new Map(
        engine.loops.flatMap((loop) =>
          loop.acts.map((act) => [act.id, act.citation.recordVersionId] as const),
        ),
      ),
    [engine],
  );
  const sourceOfAct = useCallback(
    (id: string): ActSource | null => {
      const recordVersionId = recordOfAct.get(id);
      return recordVersionId
        ? describeSource(projectId, recordVersionId, sources[recordVersionId])
        : null;
    },
    [recordOfAct, projectId, sources],
  );
```

5. In the document `keydown` handler, after `if (view !== 'graph' || isTyping(event.target)) return;`, add:

```ts
      if (event.key === 'Escape' && tip) {
        event.preventDefault();
        hideAct();
        return;
      }
```

and add `tip, hideAct` to that effect's dependency list.

6. In `<PromiseGraph`, replace `onHoverAct={onHoverAct}` with:

```tsx
              onShowAct={showAct}
              onLeaveAct={leaveAct}
              onHideAct={hideAct}
              actSource={sourceOfAct}
```

7. Replace the whole `{tip && hoveredAct && ( <div className="tip" ...> ... </div> )}` block with:

```tsx
      {tip && hoveredAct && (
        <ActCard
          act={hoveredAct}
          loopTitle={engine.loops.find((loop) => loop.loop.id === tip.glyph.loopId)?.loop.title ?? ''}
          anchor={tip.anchor}
          source={sourceOfAct(hoveredAct.id)}
          directory={directory}
          timeZone={context.timeZone}
          onEnter={cancelClose}
          onLeave={leaveAct}
        />
      )}
```

- [ ] **Step 9: Make the card take the pointer**

In `src/app/globals.css`, in the `.tip` block, replace `pointer-events: none;` with `pointer-events: auto;`, and add after the `.tip q` block:

```css
  .tip-src {
    display: block;
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid color-mix(in srgb, var(--surface) 30%, transparent);
  }
  .tip-src a {
    color: var(--surface);
    font-weight: 700;
  }
  .tip-loop {
    display: block;
    font-size: 11px;
    opacity: 0.75;
    margin-bottom: 2px;
  }
  .tip .src-icon {
    vertical-align: -2px;
    margin-right: 4px;
  }
```

- [ ] **Step 10: Run the tests and see them pass**

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 0. The two new tests and every older graph test pass.

- [ ] **Step 11: Commit**

```bash
npx pnpm@11.25.0 format
git add src/components/graph src/app/globals.css tests/e2e/graph.spec.ts
git commit -m "feat: hover card names the message source and keeps its link reachable"
```

---

### Task 11: Source labels at 80 % zoom or more

**Files:**
- Create: `src/components/graph/act-labels.ts`
- Modify: `src/components/graph/BranchEdge.tsx` (labels group)
- Modify: `src/components/graph/ActNode.tsx` (remove the detail label)
- Modify: `src/components/graph/GraphScreen.tsx` (row height)
- Modify: `src/app/globals.css`
- Test: `tests/unit/graph/act-labels.test.ts`, `tests/e2e/graph.spec.ts`

**Interfaces:**
- Consumes: `ActSource`, `SourceApp`, `SOURCE_APP_NAME` (Task 9); `GraphUi.actSource`, `SourceIcon` (Task 10).
- Produces:
  - `type ActLabel = { glyphId: string; x: number; act: string | null; source: { app: SourceApp; text: string; href: string; external: boolean; title: string } | null }`
  - `actLabels(glyphs: readonly ActGlyph[], sourceOf: (glyphId: string) => ActSource | null): ActLabel[]`
  - `fitLabel(text: string, room: number): string`
  - Labels render only at `ui.lod === 2` (80 % zoom or more).

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/graph/act-labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { actLabels, fitLabel } from '../../../src/components/graph/act-labels';
import type { ActGlyph } from '../../../src/contracts/layout';
import type { ActSource } from '../../../src/components/graph/source-link';

const glyph = (id: string, x: number): ActGlyph => ({
  id,
  loopId: 'loop',
  type: 'promise',
  x,
  y: 100,
  dayStartX: x - 10,
  dayEndX: x + 34,
  glyph: '●',
  label: 'promise MT',
  accessibleName: 'Promise by Minh Tran, 2026-10-01 09:00',
});
const slack: ActSource = {
  app: 'slack',
  label: '#larkspur-onboarding',
  link: { href: 'https://x.slack.com/a', text: 'Open in Slack', external: true },
};

describe('actLabels', () => {
  it('shows the icon, the source label and the act label with 90 px of room or more', () => {
    const [label] = actLabels([glyph('a', 0), glyph('b', 300)], () => slack);
    expect(label.source).toMatchObject({ app: 'slack', text: '#larkspur-onboarding ↗' });
    expect(label.source?.title).toBe('Slack · #larkspur-onboarding: Open in Slack');
    expect(label.act).toBe('promise MT');
  });
  it('shows the icon only with 24 to 89 px of room, and drops an act label that does not fit', () => {
    const [label] = actLabels([glyph('a', 0), glyph('b', 60)], () => slack);
    expect(label.source).toMatchObject({ app: 'slack', text: '↗' });
    expect(label.act).toBeNull();
  });
  it('shows no label under 24 px of room', () => {
    const labels = actLabels([glyph('a', 0), glyph('b', 20)], () => slack);
    expect(labels.map((item) => item.glyphId)).toEqual(['b']);
  });
  it('gives the last glyph 160 px of room', () => {
    const [label] = actLabels([glyph('a', 0)], () => slack);
    expect(label.source?.text).toBe('#larkspur-onboarding ↗');
  });
  it('measures room in x order, not in act order', () => {
    const labels = actLabels([glyph('late', 300), glyph('early', 0)], () => slack);
    expect(labels.map((item) => item.glyphId)).toEqual(['early', 'late']);
  });
  it('keeps the act label when the source is unknown', () => {
    const [label] = actLabels([glyph('a', 0)], () => null);
    expect(label).toMatchObject({ act: 'promise MT', source: null });
  });
  it('truncates a long source label with an ellipsis', () => {
    expect(fitLabel('x'.repeat(200), 90)).toMatch(/^x+…$/);
    expect(fitLabel('x'.repeat(200), 90).length).toBeLessThanOrEqual(Math.floor(90 / 5.8));
  });
});
```

- [ ] **Step 2: Write the failing e2e tests** (append to `tests/e2e/graph.spec.ts`)

```ts
const zoomPreset = async (page: Page, name: string) => {
  await page
    .getByRole('toolbar', { name: 'Canvas controls' })
    .getByRole('button', { name: 'Zoom level' })
    .click();
  await page.getByRole('menuitem', { name }).click();
};

test('at 100 % source labels link to the message or the record and never take Tab focus', async ({
  page,
}) => {
  await signIn(page);
  await zoomPreset(page, '100%');
  const labels = page.locator('a.src-label');
  await expect(labels.first()).toBeAttached();
  const hrefs = await labels.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href') ?? ''),
  );
  for (const href of hrefs)
    expect(href).toMatch(/^(https:\/\/|\/projects\/[0-9a-f-]+\/records\/[0-9a-f-]+$)/);
  expect(await labels.evaluateAll((nodes) => nodes.every((n) => n.getAttribute('tabindex') === '-1'))).toBe(true);
});

test('a click on an in-app source label opens the record', async ({ page }) => {
  await signIn(page);
  await zoomPreset(page, '100%');
  const label = page.locator('a.src-label[href^="/projects/"]').first();
  // The graph pans with a transform, so the label can sit outside the viewport; a dispatched click still follows the link.
  await label.dispatchEvent('click');
  await expect(page).toHaveURL(/\/records\/[0-9a-f-]+$/);
});
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/graph/act-labels.test.ts > /tmp/unit.log 2>&1; echo $?`
Expected: exit 1, unresolved import `act-labels`.

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts -g "source label" > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 1, no `a.src-label` element.

- [ ] **Step 4: Create the label rule**

Create `src/components/graph/act-labels.ts`:

```ts
import type { ActGlyph } from '../../contracts/layout';
import { SOURCE_APP_NAME, type SourceApp } from '../../lib/source-app';
import type { ActSource } from './source-link';

export type ActLabel = {
  glyphId: string;
  x: number;
  act: string | null;
  source: { app: SourceApp; text: string; href: string; external: boolean; title: string } | null;
};

const GAP = 6,
  LAST_ROOM = 160,
  FULL_ROOM = 90,
  ICON_ROOM = 24,
  ICON_PX = 15,
  // Average width of a 10 px Overpass character; close enough to keep labels apart.
  CHAR_PX = 5.8,
  ARROW = '↗';

export function fitLabel(text: string, room: number): string {
  const max = Math.floor(room / CHAR_PX);
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

export function actLabels(
  glyphs: readonly ActGlyph[],
  sourceOf: (glyphId: string) => ActSource | null,
): ActLabel[] {
  const sorted = [...glyphs].sort((a, b) => a.x - b.x);
  return sorted.flatMap((glyph, index) => {
    const room = (sorted[index + 1]?.x ?? glyph.x + LAST_ROOM) - glyph.x - GAP;
    const act = glyph.label.length * CHAR_PX <= room ? glyph.label : null;
    const source = sourceOf(glyph.id);
    let label: ActLabel['source'] = null;
    if (source?.app && source.label && room >= ICON_ROOM) {
      const arrow = source.link.external ? ARROW : '';
      const text =
        room >= FULL_ROOM
          ? `${fitLabel(source.label, room - ICON_PX - CHAR_PX * 2)}${arrow ? ` ${arrow}` : ''}`
          : arrow;
      label = {
        app: source.app,
        text,
        href: source.link.href,
        external: source.link.external,
        title: `${SOURCE_APP_NAME[source.app]} · ${source.label}: ${source.link.text}`,
      };
    }
    return act || label ? [{ glyphId: glyph.id, x: glyph.x - GAP, act, source: label }] : [];
  });
}
```

- [ ] **Step 5: Draw the labels in `BranchEdge`**

In `src/components/graph/BranchEdge.tsx`:

1. Add `import { actLabels } from './act-labels';` and `import { SourceIcon } from './SourceIcon';`.
2. Keep the branch title from Task 6 (`ui.lod >= 1`, class `br-title`). It sits below the line, so it does not touch the labels above.
3. After the closing `</g>` of the `.br` group, add:

```tsx
      {ui.lod === 2 && (
        <g className="act-labels">
          {actLabels(branch.glyphs, ui.actSource).map((label) => (
            <g key={label.glyphId}>
              {label.source && (
                <a
                  className="src-label nopan"
                  href={label.source.href}
                  tabIndex={-1}
                  aria-label={label.source.title}
                  {...(label.source.external
                    ? { target: '_blank', rel: 'noopener noreferrer' }
                    : {})}
                >
                  <title>{label.source.title}</title>
                  <SourceIcon app={label.source.app} size={12} x={label.x} y={y - 33} />
                  {label.source.text && (
                    <text x={label.x + 15} y={y - 24} fontSize="10" fontWeight="600">
                      {label.source.text}
                    </text>
                  )}
                </a>
              )}
              {label.act && (
                <text x={label.x} y={y - 10} fontSize="10" fill="var(--ink-2)" aria-hidden="true">
                  {label.act}
                </text>
              )}
            </g>
          ))}
        </g>
      )}
```

The labels have `tabIndex={-1}`, because Tab must keep walking milestones and branches (SRD 7.3). Keyboard users reach the same links in the loop panel.

- [ ] **Step 6: Check `ActNode`**

Task 6 already removed the act label from `ActNode`. Run `grep -n "glyph.label" src/components/graph/ActNode.tsx` and expect no output.

- [ ] **Step 7: Style the labels** (in `src/app/globals.css`, after `.br-sel .line:not(.tail)`)

```css
  .src-label {
    color: var(--route);
  }
  .src-label text {
    fill: var(--route);
  }
  .src-label:hover text {
    text-decoration: underline;
  }
```

- [ ] **Step 8: Run the tests and see them pass**

Run: `npx pnpm@11.25.0 exec vitest run tests/unit/graph > /tmp/unit.log 2>&1; echo $?`
Expected: exit 0, `Tests  7 passed (7)` for `act-labels`.

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 0. The keyboard test (`Tab reaches a branch`) still passes.

- [ ] **Step 9: Commit**

```bash
npx pnpm@11.25.0 format
git add src/components/graph src/app/globals.css tests
git commit -m "feat: source labels with links at detail zoom"
```

---

### Task 12: Drag of event dots and "Reset layout"

**Files:**
- Create: `src/components/graph/use-act-drag.ts`
- Modify: `src/components/graph/ui-context.ts`
- Modify: `src/components/graph/BranchEdge.tsx` (hit dot)
- Modify: `src/components/graph/PromiseGraph.tsx` (props and `ui`)
- Modify: `src/components/graph/GraphScreen.tsx` (offsets state)
- Modify: `src/components/graph/FilterBar.tsx` (button)
- Modify: `src/app/globals.css`
- Test: `tests/e2e/graph.spec.ts`

**Interfaces:**
- Consumes: `applyLayoutOffsets`, `NO_OFFSETS`, `LayoutOffsets` (Task 3); `browserStore`, `readOffsets`, `writeOffsets`, `withOffset`, `hasOffsets` (Task 4); `BASE_ROW_HEIGHT` (Task 5); the viewport zoom in `PromiseGraph` (Task 6); `hideAct` in `GraphScreen` (Task 10).
- Produces:
  - `useActDrag(options: DragOptions): { startDrag(event: ReactPointerEvent<SVGCircleElement>, glyph: ActGlyph, branch: BranchLayout): void; takeDragClick(): boolean; isDragging(): boolean }`
  - `type DragOptions = { offsets: LayoutOffsets; loopShift(loopId: string): number; loopBounds(loopId: string): { low: number; high: number }; onPreview(next: LayoutOffsets): void; onCommit(next: LayoutOffsets): void; onStart(): void }`
  - `GraphUi.startDrag(...)`, `GraphUi.takeDragClick(): boolean`; `PromiseGraphProps.onStartDrag(...)`, `PromiseGraphProps.takeDragClick(): boolean`
  - `FilterBar` props `canResetLayout: boolean; onResetLayout(): void`

- [ ] **Step 1: Write the failing tests** (append to `tests/e2e/graph.spec.ts`)

```ts
const centre = async (locator: Locator) => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const dragBy = async (page: Page, from: { x: number; y: number }, dx: number, dy: number) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
};

test('a dragged dot moves its branch inside the lane, survives a reload and resets', async ({
  page,
}) => {
  await signIn(page);
  const branch = page.getByRole('button', { name: /^Loop: Client secret renewal/ });
  const label = (await branch.getAttribute('aria-label'))!;
  const department = label.slice('Loop: '.length).split(', ')[1];
  const lane = (await page
    .getByTestId('lane-column')
    .getByText(department, { exact: true })
    .boundingBox())!;
  const dot = branch.locator('circle.hit-dot').first();
  const names = await branches(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''),
  );
  const other = page.getByRole('button', {
    name: names.find((name) => name !== label)!,
    exact: true,
  });
  const otherBefore = await centre(other);
  const start = await centre(dot);
  const up = start.y - lane.y > lane.y + lane.height - start.y;
  await dragBy(page, start, 0, up ? -400 : 400);
  const moved = await centre(dot);
  expect(Math.abs(moved.y - start.y)).toBeGreaterThan(2);
  expect(moved.y).toBeGreaterThanOrEqual(lane.y + 14);
  expect(moved.y).toBeLessThanOrEqual(lane.y + lane.height - 14);
  expect((await centre(other)).x).toBe(otherBefore.x);
  await expect(loopPanel(page)).toBeHidden();

  await page.reload();
  await expect(page.getByRole('group', { name: /promise graph for/i })).toHaveAttribute(
    'data-ready',
    'true',
  );
  await expect.poll(async () => Math.round((await centre(dot)).y)).toBe(Math.round(moved.y));
  await page.getByRole('button', { name: 'Reset layout' }).click();
  await expect.poll(async () => Math.round((await centre(dot)).y)).toBe(Math.round(start.y));
  await expect(page.getByRole('button', { name: 'Reset layout' })).toHaveCount(0);
  await dot.click();
  await expect(loopPanel(page)).toBeVisible();
});

test('at 200 % a dragged dot stays inside its day', async ({ page }) => {
  await signIn(page);
  const branch = page.getByRole('button', { name: /^Loop: Client secret renewal/ });
  await branch.locator('.hit').dispatchEvent('dblclick');
  await zoomPreset(page, '200%');
  const graph = page.getByRole('group', { name: /promise graph for/i });
  await expect.poll(() => graph.getAttribute('data-zoom')).toBe('2.00');
  const dot = branch.locator('circle.hit-dot').nth(1);
  await dragBy(page, await centre(dot), 300, 0);
  const right = (await centre(dot)).x;
  await dragBy(page, await centre(dot), -300, 0);
  const left = (await centre(dot)).x;
  expect(right - left).toBeGreaterThan(0);
  // A day is 18 layout px, so 36 screen px at 200 %.
  expect(right - left).toBeLessThanOrEqual(36);
});

test('a one-finger touch drag moves a dot and the page does not scroll', async ({ page }) => {
  await signIn(page);
  const dot = page
    .getByRole('button', { name: /^Loop: Client secret renewal/ })
    .locator('circle.hit-dot')
    .first();
  const start = await centre(dot);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: start.x, y, id: 1 }],
    });
  await touch('touchStart', start.y);
  for (const step of [10, 20, 30, 40]) await touch('touchMove', start.y + step);
  await touch('touchEnd', 0);
  await expect.poll(async () => (await centre(dot)).y).not.toBe(start.y);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
});
```

Change the first line of the file to `import { expect, test, type Locator, type Page } from '@playwright/test';`. If the Task 11 `zoomPreset` helper is not in the file yet, add it with these tests.

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts -g "dragged dot|touch drag" > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 1. The dot does not move (`Math.abs(moved.y - start.y)` is 0), or the graph pans.

- [ ] **Step 3: Create the drag hook**

Create `src/components/graph/use-act-drag.ts`:

```ts
'use client';
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { ActGlyph, BranchLayout } from '../../contracts/layout';
import type { LayoutOffsets } from '../../lib/graph-layout';
import { withOffset } from './offset-store';

const THRESHOLD = 4;

export type DragOptions = {
  offsets: LayoutOffsets;
  /** Current displayed shift of the loop's line from its packed row. */
  loopShift(loopId: string): number;
  /** Shift range that keeps the line inside its lane. */
  loopBounds(loopId: string): { low: number; high: number };
  onPreview(next: LayoutOffsets): void;
  onCommit(next: LayoutOffsets): void;
  onStart(): void;
};

export function useActDrag(options: DragOptions) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const dragging = useRef(false);
  const dragged = useRef(false);

  const startDrag = useCallback(
    (
      event: ReactPointerEvent<SVGCircleElement>,
      glyph: ActGlyph,
      branch: BranchLayout,
      zoom: number,
    ) => {
      if (event.button !== 0 || dragging.current) return;
      const opts = latest.current;
      const width = Math.max(1, glyph.dayEndX - glyph.dayStartX);
      const saved = opts.offsets,
        x0 = event.clientX,
        y0 = event.clientY;
      const fraction0 = (glyph.x - glyph.dayStartX) / width,
        shift0 = opts.loopShift(branch.loopId),
        bounds = opts.loopBounds(branch.loopId);
      let point = { x: x0, y: y0 },
        frame: number | null = null,
        moved = false,
        current = saved;
      dragging.current = true;

      const apply = () => {
        frame = null;
        // The threshold is in screen px; the offsets are in layout px, so the move divides by the zoom.
        if (!moved && Math.hypot(point.x - x0, point.y - y0) < THRESHOLD) return;
        const dx = (point.x - x0) / zoom,
          dy = (point.y - y0) / zoom;
        if (!moved) {
          moved = true;
          document.body.classList.add('dragging-act');
          latest.current.onStart();
        }
        const fraction = Math.min(1, Math.max(0, fraction0 + dx / width));
        const shift = Math.min(bounds.high, Math.max(bounds.low, shift0 + dy));
        current = withOffset(
          withOffset(saved, 'acts', glyph.id, fraction),
          'loops',
          branch.loopId,
          shift,
        );
        latest.current.onPreview(current);
      };
      const move = (next: PointerEvent) => {
        point = { x: next.clientX, y: next.clientY };
        frame ??= requestAnimationFrame(apply);
      };
      const stop = (commit: boolean) => {
        if (frame !== null) cancelAnimationFrame(frame);
        if (commit) apply();
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', key, true);
        document.body.classList.remove('dragging-act');
        dragging.current = false;
        if (!moved) return;
        // The click that follows pointerup must not open the loop panel.
        dragged.current = true;
        if (commit) latest.current.onCommit(current);
        else latest.current.onPreview(saved);
      };
      const up = () => stop(true);
      const cancel = () => stop(false);
      const key = (next: KeyboardEvent) => {
        if (next.key !== 'Escape' || !moved) return;
        next.preventDefault();
        next.stopPropagation();
        stop(false);
      };
      // React can re-create the dot element during a drag, so the drag listens on the window.
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', key, true);
    },
    [],
  );
  const takeDragClick = useCallback(() => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  }, []);
  const isDragging = useCallback(() => dragging.current, []);
  return { startDrag, takeDragClick, isDragging };
}
```

- [ ] **Step 4: Extend the UI context**

In `src/components/graph/ui-context.ts`, add `type PointerEvent as ReactPointerEvent` to the React import, add `BranchLayout` to the layout import, and add to `GraphUi`:

```ts
  startDrag(event: ReactPointerEvent<SVGCircleElement>, glyph: ActGlyph, branch: BranchLayout): void;
  takeDragClick(): boolean;
```

- [ ] **Step 5: Start drags from the hit dot**

In `src/components/graph/BranchEdge.tsx`, change the `hit-dot` circle to:

```tsx
          <circle
            key={glyph.id}
            className="hit-dot nopan"
            cx={glyph.x}
            cy={y}
            r={9}
            onPointerDown={(event) => ui.startDrag(event, glyph, branch)}
            onClick={(event) => {
              event.stopPropagation();
              if (ui.takeDragClick()) return;
              ui.selectLoop(branch.loopId, glyph.id);
            }}
            onMouseEnter={(event) => ui.showAct(glyph, event.currentTarget)}
            onMouseLeave={() => ui.leaveAct()}
          />
```

`nopan` is React Flow's class that stops a pane pan from starting on an element.

- [ ] **Step 6: Pass the drag through `PromiseGraph`**

In `src/components/graph/PromiseGraph.tsx`, add to `PromiseGraphProps`:

```ts
  onStartDrag(
    event: ReactPointerEvent<SVGCircleElement>,
    glyph: ActGlyph,
    branch: BranchLayout,
    zoom: number,
  ): void;
  takeDragClick(): boolean;
```

Destructure `onStartDrag, takeDragClick` in `Graph`. Add to the `ui` memo object `startDrag: (event, glyph, branch) => onStartDrag(event, glyph, branch, viewport.zoom), takeDragClick,` and add `onStartDrag`, `takeDragClick` and `viewport.zoom` to its dependency list. The prop type is `onStartDrag(event: ReactPointerEvent<SVGCircleElement>, glyph: ActGlyph, branch: BranchLayout, zoom: number): void;`.

- [ ] **Step 7: Own the offsets in `GraphScreen`**

In `src/components/graph/GraphScreen.tsx`:

1. Imports: change the layout import to `import { NO_OFFSETS, applyLayoutOffsets, createTimeScale, layoutPromiseGraph, type LayoutOffsets } from '../../lib/graph-layout';`, and add `import { browserStore, hasOffsets, readOffsets, writeOffsets } from './offset-store';` and `import { useActDrag } from './use-act-drag';`.
2. Rename the Task 6 `layout` memo to `baseLayout`, add `const rowHeight = BASE_ROW_HEIGHT;` (import it from `../../lib/graph-layout`), and add after the memo:

```ts
  const [offsets, setOffsets] = useState<LayoutOffsets>(NO_OFFSETS);
  useEffect(() => {
    // The server has no browser storage, so saved positions load after hydration to keep the HTML equal.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffsets(readOffsets(browserStore(), projectId));
  }, [projectId]);
  const layout = useMemo(
    () => applyLayoutOffsets(baseLayout, offsets, rowHeight),
    [baseLayout, offsets, rowHeight],
  );
  const baseBranches = useMemo(
    () => new Map(baseLayout.branches.map((branch) => [branch.loopId, branch])),
    [baseLayout],
  );
  const drag = useActDrag({
    offsets,
    loopShift: (id) =>
      (layout.branches.find((branch) => branch.loopId === id)?.y ?? 0) -
      (baseBranches.get(id)?.y ?? 0),
    loopBounds: (id) => {
      const branch = baseBranches.get(id),
        lane = baseLayout.lanes.find((item) => item.departmentId === branch?.departmentId);
      if (!branch || !lane) return { low: 0, high: 0 };
      return {
        low: lane.y + rowHeight / 2 - branch.y,
        high: lane.y + lane.height - rowHeight / 2 - branch.y,
      };
    },
    onPreview: setOffsets,
    onCommit: (next) => {
      setOffsets(next);
      writeOffsets(browserStore(), projectId, next);
    },
    onStart: () => hideAct(),
  });
  const resetLayout = useCallback(() => {
    setOffsets(NO_OFFSETS);
    writeOffsets(browserStore(), projectId, NO_OFFSETS);
  }, [projectId]);
```

Place this block after the Task 10 `hideAct` callback, because `onStart` calls it.

3. In `showAct`, add `if (drag.isDragging()) return;` as the first line, and add `drag` to its dependency list. Move the `showAct` definition below the `useActDrag` call.
4. In `<PromiseGraph`, add `onStartDrag={drag.startDrag}` and `takeDragClick={drag.takeDragClick}`.
5. In `<FilterBar`, add `canResetLayout={hasOffsets(offsets)}` and `onResetLayout={resetLayout}`.

- [ ] **Step 8: Add the button to `FilterBar`**

In `src/components/graph/FilterBar.tsx`, add `canResetLayout: boolean;` and `onResetLayout(): void;` to `Props`, destructure them, and after the "View" `Segmented` (Task 6 removed the zoom control) add:

```tsx
        {filters.view === 'graph' && canResetLayout && (
          <button type="button" className="btn" onClick={onResetLayout}>
            Reset layout
          </button>
        )}
```

- [ ] **Step 9: Cursor and touch styles** (in `src/app/globals.css`, change `.br .hit-dot` and add the drag rule)

```css
  .br .hit-dot {
    fill: transparent;
    pointer-events: all;
    cursor: grab;
    touch-action: none;
  }
  body.dragging-act,
  body.dragging-act .br,
  body.dragging-act .br .hit-dot {
    cursor: grabbing;
  }
```

- [ ] **Step 10: Run the tests and see them pass**

Run: `npx pnpm@11.25.0 exec playwright test tests/e2e/graph.spec.ts > /tmp/e2e.log 2>&1; echo $?`
Expected: exit 0. All drag tests and every older graph test pass, including `wheel and pinch both zoom the time axis`.

If the "other branch did not move" assertion fails, the pane pan starts on the dot: confirm that `nopan` is on the circle (`document.querySelector('circle.hit-dot').classList`), and add `event.stopPropagation()` as the first line of the `onPointerDown` handler.

- [ ] **Step 11: Commit**

```bash
npx pnpm@11.25.0 format
git add src/components/graph src/app/globals.css tests/e2e/graph.spec.ts
git commit -m "feat: drag event dots inside their day and lane, with a layout reset"
```

---

### Task 13: Gates, PR #7 update and merge forward into PR #8 and PR #1

**Files:**
- No new files. Conflict resolution in later branches.

**Interfaces:**
- Consumes: everything above.
- Produces: updated `phucluu/pg-06`, `phucluu/pg-07` and `phucluu/promise-graph` on `origin`.

- [ ] **Step 1: Run every gate on the branch**

```bash
for g in typecheck lint format:check check:providers eval test build; do
  npx pnpm@11.25.0 $g > /tmp/gate-$g.log 2>&1; echo "$g rc=$?"
done
npx pnpm@11.25.0 test:e2e > /tmp/gate-e2e.log 2>&1; echo "e2e rc=$?"
```

Expected: every `rc=0` (`check:providers` exists from pg-05 on, so it runs on pg-06). Read the `Tests  N passed (N)` line in `/tmp/gate-test.log` and the `N passed` line in `/tmp/gate-e2e.log`.

- [ ] **Step 2: Show the owner before the push**

Start the branch on a local server against a fresh database (see `docs/superpowers/plans/2026-10-13-promise-graph-continuation.md` for the local setup), open `http://localhost:3000`, and ask the owner to review. Push only after the owner says yes.

- [ ] **Step 3: Fast-forward PR #7**

```bash
git fetch origin
git merge-base --is-ancestor origin/phucluu/pg-06 HEAD && echo ff-ok
git push origin HEAD:refs/heads/phucluu/pg-06
```

Expected: `ff-ok`, and the push reports `cf893e6..<new> HEAD -> phucluu/pg-06` (the start SHA can differ if the owner pushed in between; then stop and ask).

- [ ] **Step 4: Merge forward into PR #8**

```bash
git worktree add --detach /tmp/pg07 origin/phucluu/pg-07
cd /tmp/pg07
npx pnpm@11.25.0 install --frozen-lockfile
git merge --no-ff origin/phucluu/pg-06 -m "Merge phucluu/pg-06: graph declutter"
```

Resolve each conflict:
- `GraphScreen.tsx`, `PromiseGraph.tsx`, `ui-context.ts`, `labels.ts`: keep both sides' additions. The new props and callbacks from this plan must survive.
- `globals.css`: keep both sides. Then run `grep -n "inset 3px 0 0" src/app/globals.css` and remove every accent bar that pg-07 adds, the same way as Task 1.
- Every `<GraphScreen` call site needs `sources={view.sources}` (or the matching variable): `grep -rn "<GraphScreen" src`.
- The canvas removed the zoom control and `data-px-per-day`. Run `grep -rn "zoomLevel\|data-px-per-day\|name: 'Detail'\|onZoom" src tests` and move every hit in the pg-07 code and tests to `ui.lod`, `data-zoom` and the % menu.

Then run `git add` on the resolved files, `git commit --no-edit` with the commit identity from Global Constraints, run Step 1's gates in `/tmp/pg07`, and push:

```bash
git push origin HEAD:refs/heads/phucluu/pg-07
```

- [ ] **Step 5: Merge forward into PR #1**

Repeat Step 4 with `origin/phucluu/promise-graph` and the new `origin/phucluu/pg-07`:

```bash
git worktree add --detach /tmp/pgtop origin/phucluu/promise-graph
cd /tmp/pgtop
npx pnpm@11.25.0 install --frozen-lockfile
git merge --no-ff origin/phucluu/pg-07 -m "Merge phucluu/pg-07: graph declutter"
```

Extra steps on this branch, because commit `4ee9cc0` made every agent or pasted permalink plain text:

1. In `src/components/inbox/links.ts`, replace the body of `activePermalink` with a call to the shared rule, so the loop panel and the record viewer follow the owner decision too:

```ts
import { linkablePermalink } from '../../lib/source-app';
...
export function activePermalink({
  source,
  permalink,
}: {
  source: SourceKind;
  permalink: string | null;
}): string | null {
  return linkablePermalink(source, permalink);
}
```

2. In `tests/unit/inbox/links.test.ts`, keep the existing cases (they still hold: `evil.example`, `javascript:`, `http:` and null stay inactive) and add:

```ts
  it('activates agent and pasted permalinks on Slack, Gmail and Linear domains', () => {
    for (const permalink of [
      'https://acme.slack.com/archives/C1/p1',
      'https://mail.google.com/mail/u/0/#inbox/abc',
      'https://linear.app/acme/issue/PG-112/x',
    ])
      expect(activePermalink({ source: 'agent', permalink })).toBe(permalink);
  });
```

3. In `docs/mcp-agent-recipe.md`, replace the sentence "The app shows a permalink of an agent or pasted record as plain text, never as a link." with: "The app shows a permalink of an agent or pasted record as a link only when it is `https://` on `slack.com` (or a subdomain), `mail.google.com` or `linear.app`, and picks the source icon from that domain. Any other permalink shows as plain text."
4. The PR #1 seed arrives through the agent path with permalinks on `fundline-larkspur.slack.example`, which is not a Slack domain. Without a change, the demo shows the agent icon and the Task 10 card test fails. Change the demo Slack domain to a real domain with a fictional workspace:
   - In `scripts/build-fixtures.ts`, change `https://fundline-larkspur.slack.example/archives/` to `https://fundline-larkspur.slack.com/archives/`.
   - Run `node --experimental-strip-types scripts/build-fixtures.ts` and commit the regenerated `fixtures/*.json`.
   - In `tests/e2e/graph.spec.ts`, rename the test `... with the source and an agent permalink as plain text` to `... with the source and a Slack link`, and replace its last three assertions with:

```ts
  const open = panel.getByRole('link', { name: /^Open in Slack$/ }).first();
  await expect(open).toHaveAttribute('href', /^https:\/\/fundline-larkspur\.slack\.com\//);
  await expect(panel.getByText('#larkspur-it').first()).toBeVisible();
```

   - Run `grep -rn "slack\.example" src tests scripts docs` and change every remaining hit the same way.

Run `tests/unit/inbox/links.test.ts`, `tests/unit/graph/source-app.test.ts` and all gates, then push:

```bash
git push origin HEAD:refs/heads/phucluu/promise-graph
```

- [ ] **Step 6: Clean up**

```bash
cd -
git worktree remove --force /tmp/pg07
git worktree remove --force /tmp/pgtop
```

Watch CI on PRs #7, #8 and #1 (`gh pr checks <n>`) until every check passes.
