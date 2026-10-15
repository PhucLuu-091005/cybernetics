import { describe, expect, it } from 'vitest';
import {
  BASE_PX_PER_DAY,
  BASE_ROW_HEIGHT,
  CARD,
  branchPath,
  createTimeScale,
  layoutPromiseGraph,
  placeCards,
} from '../../../src/lib/graph-layout';
import { deriveProject } from '../../../src/server/loops/engine';
import main from '../../../fixtures/main-snapshot.json';
import records from '../../../fixtures/records.json';
import gold from '../../../fixtures/gold.json';
import { engineInputFromFixtures } from '../../../scripts/build-fixtures';
import type { GraphSnapshot } from '../../../src/contracts';
import { GraphLayoutSchema } from '../../../src/contracts/layout';

const snapshot = main as GraphSnapshot;
const engine = deriveProject(
  engineInputFromFixtures(
    snapshot,
    records.filter((r) => r.projectKey === 'larkspur'),
    gold.T,
  ),
);
const withCards = layoutPromiseGraph(
  engine,
  { context: snapshot.context },
  { pxPerDay: BASE_PX_PER_DAY, rowHeight: BASE_ROW_HEIGHT, cards: CARD },
);
const cardsOf = () =>
  withCards.branches.flatMap((branch) =>
    branch.glyphs.map((glyph) => ({ branch, glyph, card: glyph.card! })),
  );

describe('day bounds and the shared branch path', () => {
  it('gives each glyph the bounds of its local day', () => {
    for (const branch of withCards.branches)
      for (const glyph of branch.glyphs) {
        expect(glyph.dayEndX - glyph.dayStartX).toBeCloseTo(BASE_PX_PER_DAY, 5);
        expect(glyph.x).toBeGreaterThanOrEqual(glyph.dayStartX);
        expect(glyph.x).toBeLessThanOrEqual(glyph.dayEndX);
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
    for (const branch of withCards.branches)
      expect(
        branchPath(
          branch.xStart,
          branch.xEnd,
          branch.y,
          withCards.trunkY,
          branch.endKind === 'merge',
        ),
      ).toBe(branch.path);
  });
});

describe('event cards', () => {
  it('places one card per glyph, above its own branch line', () => {
    for (const { branch, glyph, card } of cardsOf()) {
      expect(card).toBeDefined();
      expect(card.y + CARD.height).toBeLessThanOrEqual(branch.y - BASE_ROW_HEIGHT / 2 + 0.01);
      expect(card.x).toBeGreaterThanOrEqual(glyph.x - 14 - 0.01);
    }
  });
  it('never lets two cards overlap, inside a branch or across branches', () => {
    const all = cardsOf().map(({ card }) => card);
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i],
          b = all[j];
        const apart =
          a.x + CARD.width <= b.x ||
          b.x + CARD.width <= a.x ||
          a.y + CARD.height <= b.y ||
          b.y + CARD.height <= a.y;
        expect(apart).toBe(true);
      }
  });
  it('keeps every card inside the lane of its branch', () => {
    const lanes = new Map(withCards.lanes.map((lane) => [lane.departmentId, lane]));
    for (const { branch, card } of cardsOf()) {
      const lane = lanes.get(branch.departmentId)!;
      expect(card.y).toBeGreaterThanOrEqual(lane.y);
      expect(card.y + CARD.height).toBeLessThanOrEqual(lane.y + lane.height);
    }
  });
  it('slides same-day cards to the right before it opens a new shelf', () => {
    const slots = placeCards([100, 100, 100, 100], CARD);
    expect(slots.map((slot) => slot.shelf)).toEqual([0, 0, 0, 1]);
    expect(slots[1].x - slots[0].x).toBe(CARD.width + CARD.gap);
    expect(slots[3].x).toBe(slots[0].x);
  });
  it('returns output that satisfies the layout contract and leaves layouts without cards alone', () => {
    expect(GraphLayoutSchema.safeParse(withCards).success).toBe(true);
    const plain = layoutPromiseGraph(engine, { context: snapshot.context }, { pxPerDay: 12 });
    expect(plain.branches.every((branch) => branch.glyphs.every((glyph) => !glyph.card))).toBe(
      true,
    );
  });
});
