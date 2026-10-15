import { describe, expect, it } from 'vitest';
import {
  BASE_PX_PER_DAY,
  BASE_ROW_HEIGHT,
  CARD,
  createTimeScale,
  layoutPromiseGraph,
} from '../../../src/lib/graph-layout';
import { deriveProject } from '../../../src/server/loops/engine';
import main from '../../../fixtures/main-snapshot.json';
import records from '../../../fixtures/records.json';
import gold from '../../../fixtures/gold.json';
import { engineInputFromFixtures } from '../../../scripts/build-fixtures';
import type { GraphSnapshot } from '../../../src/contracts';
import { LayoutOptionsSchema } from '../../../src/contracts/layout';

const utc = { timeZone: 'UTC', windowStart: '2026-06-15' };

describe('time scale with resized day columns', () => {
  it('keeps the uniform scale without widths', () => {
    const scale = createTimeScale(utc, 10);
    expect(scale.dateStartX('2026-06-16')).toBe(10);
    expect(scale.dateEndX('2026-06-16')).toBe(20);
    expect(scale.x('2026-06-16T12:00:00Z')).toBe(15);
  });
  it('widens one day and shifts every later day by the difference', () => {
    const scale = createTimeScale(utc, 10, { '2026-06-16': 30 });
    expect(scale.dateStartX('2026-06-15')).toBe(0);
    expect(scale.dateStartX('2026-06-16')).toBe(10);
    expect(scale.dateEndX('2026-06-16')).toBe(40);
    expect(scale.dateX('2026-06-16')).toBe(25);
    expect(scale.x('2026-06-16T12:00:00Z')).toBe(25);
    expect(scale.x('2026-06-17T12:00:00Z')).toBe(45);
    expect(scale.dayRange('2026-06-16T03:00:00Z')).toEqual({ start: 10, end: 40 });
  });
  it('narrows a day, and a day before the window start keeps the base width', () => {
    const scale = createTimeScale(utc, 10, { '2026-06-17': 4, '2026-06-10': 50 });
    expect(scale.dateStartX('2026-06-18')).toBe(24);
    expect(scale.x('2026-06-14T12:00:00Z')).toBe(-5);
  });
  it('keeps the local day on a daylight saving change', () => {
    const scale = createTimeScale({ timeZone: 'America/New_York', windowStart: '2026-03-07' }, 10, {
      '2026-03-08': 23,
    });
    expect(scale.dayRange('2026-03-08T12:00:00-04:00')).toEqual({ start: 10, end: 33 });
    expect(scale.x('2026-03-09T00:00:00-04:00')).toBe(33);
  });
});

describe('layout with resized day columns', () => {
  const snapshot = main as GraphSnapshot;
  const engine = deriveProject(
    engineInputFromFixtures(
      snapshot,
      records.filter((r) => r.projectKey === 'larkspur'),
      gold.T,
    ),
  );
  const options = { pxPerDay: BASE_PX_PER_DAY, rowHeight: BASE_ROW_HEIGHT, cards: CARD };
  it('gives a glyph on a widened day that day as its bounds', () => {
    const base = layoutPromiseGraph(engine, { context: snapshot.context }, options);
    const glyph = base.branches.flatMap((branch) => branch.glyphs)[0];
    const date = createTimeScale(snapshot.context, BASE_PX_PER_DAY)
      .localStamp(
        engine.loops.flatMap((loop) => loop.acts).find((act) => act.id === glyph.id)!.occurredAt,
      )
      .slice(0, 10);
    const wide = layoutPromiseGraph(
      engine,
      { context: snapshot.context },
      { ...options, dayWidths: { [date]: 300 } },
    );
    const moved = wide.branches
      .flatMap((branch) => branch.glyphs)
      .find((item) => item.id === glyph.id)!;
    expect(moved.dayEndX - moved.dayStartX).toBe(300);
    const before = base.days.find((day) => day.date === date)!.width;
    expect(wide.days.find((day) => day.date === date)!.width).toBe(300);
    expect(wide.width).toBeCloseTo(base.width + 300 - before, 1);
  });
  it('rejects a width outside 24–480 px and a key that is not a date', () => {
    for (const dayWidths of [{ '2026-06-16': 10 }, { '2026-06-16': 900 }, { tomorrow: 60 }])
      expect(LayoutOptionsSchema.safeParse({ ...options, dayWidths }).success).toBe(false);
  });
});

describe('event slots', () => {
  const event = (id: string, at: string, lane: string, width = 186) => ({ id, at, lane, width });
  it('gives each event of one lane its own slot, in time order, and widens the day to fit', () => {
    const scale = createTimeScale(utc, 64, {}, [
      event('a', '2026-06-16T09:20:00Z', 'loop-1'),
      event('b', '2026-06-16T10:45:00Z', 'loop-1'),
      event('c', '2026-06-16T15:10:00Z', 'loop-1'),
    ]);
    expect(scale.dateStartX('2026-06-16')).toBe(64);
    expect(scale.eventX('a')).toBe(64 + 93);
    expect(scale.eventX('b')).toBe(64 + 93 + 186);
    expect(scale.eventX('c')).toBe(64 + 93 + 372);
    expect(scale.dateEndX('2026-06-16')).toBe(64 + 3 * 186);
    expect(scale.x('2026-06-16T10:45:00Z')).toBe(scale.eventX('b'));
    expect(scale.x('2026-06-16T10:00:00Z')).toBeGreaterThan(scale.eventX('a')!);
    expect(scale.x('2026-06-16T10:00:00Z')).toBeLessThan(scale.eventX('b')!);
    expect(scale.dateStartX('2026-06-17')).toBe(64 + 3 * 186);
  });
  it('lets events of different lanes share room, and a day without events keeps the base width', () => {
    const scale = createTimeScale(utc, 64, {}, [
      event('a', '2026-06-16T09:20:00Z', 'loop-1'),
      event('b', '2026-06-16T09:20:00Z', 'loop-2'),
      event('c', '2026-06-16T09:30:00Z', 'loop-3'),
    ]);
    expect(scale.eventX('a')).toBe(scale.eventX('b'));
    expect(scale.eventX('c')).toBe(scale.eventX('a')! + 2);
    expect(scale.dateEndX('2026-06-16') - scale.dateStartX('2026-06-16')).toBe(188);
    expect(scale.dateEndX('2026-06-18') - scale.dateStartX('2026-06-18')).toBe(64);
  });
  it('scales the slots of a day the user resized', () => {
    const scale = createTimeScale(utc, 64, { '2026-06-16': 186 }, [
      event('a', '2026-06-16T09:20:00Z', 'loop-1'),
      event('b', '2026-06-16T10:45:00Z', 'loop-1'),
    ]);
    expect(scale.eventX('a')).toBe(64 + 46.5);
    expect(scale.eventX('b')).toBe(64 + 139.5);
    expect(scale.dateEndX('2026-06-16')).toBe(64 + 186);
  });
});
