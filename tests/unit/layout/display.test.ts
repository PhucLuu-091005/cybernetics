import { describe, expect, it } from 'vitest';
import {
  BASE_PX_PER_DAY,
  BASE_ROW_HEIGHT,
  CARD,
  SCREEN_MIN,
  displayLayout,
  layoutPromiseGraph,
  mapPathY,
  stackGlyphs,
} from '../../../src/lib/graph-layout';
import { deriveProject } from '../../../src/server/loops/engine';
import main from '../../../fixtures/main-snapshot.json';
import records from '../../../fixtures/records.json';
import gold from '../../../fixtures/gold.json';
import { engineInputFromFixtures } from '../../../scripts/build-fixtures';
import type { GraphSnapshot } from '../../../src/contracts';
import type { ActGlyph } from '../../../src/contracts/layout';

const snapshot = main as GraphSnapshot;
const engine = deriveProject(
  engineInputFromFixtures(
    snapshot,
    records.filter((r) => r.projectKey === 'larkspur'),
    gold.T,
  ),
);
const layout = layoutPromiseGraph(
  engine,
  { context: snapshot.context },
  { pxPerDay: BASE_PX_PER_DAY, rowHeight: BASE_ROW_HEIGHT, cards: CARD },
);
const rowsOnScreen = (zoom: number, scale = {}) => {
  const shown = displayLayout(layout, zoom, scale);
  return { shown };
};

describe('displayLayout', () => {
  it('puts the trunk and its milestones above every lane, in the old lane order', () => {
    const shown = displayLayout(layout, 1);
    const top = Math.min(...shown.lanes.map((lane) => lane.y));
    expect(shown.trunkY).toBeLessThan(top);
    for (const milestone of shown.milestones) expect(milestone.y).toBe(shown.trunkY);
    const order = (l: typeof layout) =>
      [...l.lanes].sort((a, b) => a.y - b.y).map((lane) => lane.departmentId);
    expect(order(shown)).toEqual(order(layout));
  });
  it('keeps every x and, with the cards shown, every distance inside a lane', () => {
    const shown = displayLayout(layout, 1);
    shown.branches.forEach((branch, index) => {
      const before = layout.branches[index];
      expect(branch.xStart).toBe(before.xStart);
      const lane = layout.lanes.find((item) => item.departmentId === before.departmentId)!;
      const after = shown.lanes.find((item) => item.departmentId === before.departmentId)!;
      expect(branch.y - after.y).toBeCloseTo(before.y - lane.y, 6);
    });
  });
  it('keeps rows of a lane 22 px apart, and 8 px from the lane border, when zoomed out', () => {
    for (const zoom of [0.02, 0.05, 0.1, 0.3]) {
      const { shown } = rowsOnScreen(zoom);
      for (const lane of shown.lanes) {
        const ys = [
          ...new Set(
            shown.branches.filter((b) => b.departmentId === lane.departmentId).map((b) => b.y),
          ),
        ].sort((a, b) => a - b);
        for (let i = 1; i < ys.length; i++)
          expect((ys[i] - ys[i - 1]) * zoom).toBeGreaterThanOrEqual(SCREEN_MIN.row - 1e-6);
        if (ys.length) {
          expect((ys[0] - lane.y) * zoom).toBeGreaterThanOrEqual(SCREEN_MIN.edge - 1e-6);
          expect((lane.y + lane.height - ys[ys.length - 1]) * zoom).toBeGreaterThanOrEqual(
            SCREEN_MIN.edge - 1e-6,
          );
        }
      }
    }
  });
  it('stretches one lane and moves the lanes below it', () => {
    const id = layout.lanes[0].departmentId;
    const plain = displayLayout(layout, 0.05),
      tall = displayLayout(layout, 0.05, { [id]: 2 });
    const lane = (l: typeof layout) => l.lanes.find((item) => item.departmentId === id)!;
    expect(lane(tall).height).toBeCloseTo(lane(plain).height * 2, 6);
    expect(tall.height).toBeGreaterThan(plain.height);
  });
  it('moves branch paths with their rows and leaves x alone', () => {
    const shown = displayLayout(layout, 0.05);
    const branch = shown.branches.find((b) => b.path.includes(' H'))!;
    expect(branch.path).toContain(` ${branch.y}`);
    expect(mapPathY('M1 2 C3 4 5 6 7 8 H9 V10', (v) => v * 10)).toBe(
      'M1 20 C3 40 5 60 7 80 H9 V100',
    );
  });
});

describe('stackGlyphs', () => {
  const glyph = (id: string, x: number, type: ActGlyph['type']): ActGlyph =>
    ({ id, x, type }) as ActGlyph;
  it('merges icons closer than an icon on screen and leads with the most telling one', () => {
    const stacks = stackGlyphs(
      [
        glyph('a', 0, 'request'),
        glyph('b', 100, 'reject'),
        glyph('c', 200, 'promise'),
        glyph('d', 2000, 'accept'),
      ],
      0.05,
    );
    expect(stacks.map((s) => s.glyphs.map((g) => g.id))).toEqual([['a', 'b', 'c'], ['d']]);
    expect(stacks[0].lead.id).toBe('b');
  });
  it('picks the latest event on a tie and keeps far icons apart', () => {
    const stacks = stackGlyphs([glyph('a', 0, 'follow_up'), glyph('b', 100, 'request')], 1);
    expect(stacks.map((s) => s.lead.id)).toEqual(['a', 'b']);
    expect(
      stackGlyphs([glyph('a', 0, 'follow_up'), glyph('b', 10, 'request')], 0.05)[0].lead.id,
    ).toBe('b');
  });
});
