import { describe, expect, it } from 'vitest';
import {
  BASE_PX_PER_DAY,
  BASE_ROW_HEIGHT,
  CARD,
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
    // A dot alone in its day, so only the day bounds limit it.
    const b = base.branches.find(
        (item) =>
          item.glyphs.length >= 2 &&
          item.glyphs[0].dayStartX < item.glyphs[1].dayStartX &&
          (item.glyphs.length === 2 || item.glyphs[2].dayStartX > item.glyphs[1].dayStartX),
      )!,
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
  it('never lets a dragged act pass an act of its loop that happened before or after it', () => {
    const layout = layoutPromiseGraph(
      engine,
      { context: snapshot.context },
      { pxPerDay: BASE_PX_PER_DAY, rowHeight: BASE_ROW_HEIGHT, cards: CARD },
    );
    const b = layout.branches.find(
      (item) => item.glyphs.length >= 2 && item.glyphs[0].dayStartX === item.glyphs[1].dayStartX,
    )!;
    const [first, second] = b.glyphs;
    const earlier = branchOf(
      applyLayoutOffsets(layout, { acts: { [second.id]: 0 }, loops: {} }, BASE_ROW_HEIGHT),
      b.id,
    ).glyphs;
    expect(earlier[1].x).toBeGreaterThan(earlier[0].x);
    expect(earlier[0].x).toBe(first.x);
    const later = branchOf(
      applyLayoutOffsets(layout, { acts: { [first.id]: 1 }, loops: {} }, BASE_ROW_HEIGHT),
      b.id,
    ).glyphs;
    expect(later[0].x).toBeLessThan(later[1].x);
    expect(later[1].x).toBe(second.x);
  });
  it('moves a card by its own offset and leaves its act in place', () => {
    const layout = layoutPromiseGraph(
      engine,
      { context: snapshot.context },
      { pxPerDay: BASE_PX_PER_DAY, rowHeight: BASE_ROW_HEIGHT, cards: CARD },
    );
    const b = layout.branches.find((item) => item.glyphs.length > 0)!,
      g = b.glyphs[0];
    const moved = branchOf(
      applyLayoutOffsets(
        layout,
        { acts: {}, loops: {}, cards: { [g.id]: { dx: 30, dy: -40 } } },
        BASE_ROW_HEIGHT,
      ),
      b.id,
    ).glyphs[0];
    expect(moved.x).toBe(g.x);
    expect(moved.y).toBe(g.y);
    expect(moved.card).toEqual({ x: g.card!.x + 30, y: g.card!.y - 40 });
  });
  it('moves the cards with their dot and their branch, and keeps them inside the lane', () => {
    const layout = layoutPromiseGraph(
      engine,
      { context: snapshot.context },
      { pxPerDay: BASE_PX_PER_DAY, rowHeight: BASE_ROW_HEIGHT, cards: CARD },
    );
    const b = layout.branches.find((item) => item.glyphs.length >= 2)!,
      g = b.glyphs[0],
      lane = layout.lanes.find((item) => item.departmentId === b.departmentId)!;
    for (const shift of [-1000, 1000]) {
      const moved = branchOf(
        applyLayoutOffsets(
          layout,
          { acts: { [g.id]: 0 }, loops: { [b.loopId]: shift } },
          BASE_ROW_HEIGHT,
        ),
        b.id,
      );
      const dy = moved.y - b.y;
      expect(moved.glyphs[0].card!.x - g.card!.x).toBeCloseTo(moved.glyphs[0].x - g.x, 5);
      expect(moved.glyphs[1].card!.y - b.glyphs[1].card!.y).toBeCloseTo(dy, 5);
      for (const glyph of moved.glyphs) expect(glyph.card!.y).toBeGreaterThanOrEqual(lane.y - 0.01);
      expect(moved.y).toBeLessThanOrEqual(lane.y + lane.height - BASE_ROW_HEIGHT / 2);
    }
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
