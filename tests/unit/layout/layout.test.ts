import { describe, expect, it } from 'vitest';
import { layoutPromiseGraph, xOf } from '../../../src/lib/graph-layout';
import { deriveProject } from '../../../src/server/loops/engine';
import main from '../../../fixtures/main-snapshot.json';
import records from '../../../fixtures/records.json';
import gold from '../../../fixtures/gold.json';
import { engineInputFromFixtures } from '../../../scripts/build-fixtures';
import type { GraphSnapshot } from '../../../src/contracts';
import { GraphLayoutSchema } from '../../../src/contracts/layout';
import { customer, due, fixture } from '../../support/engine-builders';

const snapshot = main as GraphSnapshot;
const engine = deriveProject(
  engineInputFromFixtures(
    snapshot,
    records.filter((r) => r.projectKey === 'larkspur'),
    gold.T,
  ),
);
const layout = (pxPerDay = 12) =>
  layoutPromiseGraph(engine, { context: snapshot.context }, { pxPerDay });

describe('layoutPromiseGraph', () => {
  it('places time on x in the project time zone', () => {
    expect(xOf('2026-06-15T00:00:00+07:00', snapshot.context, 10)).toBe(0);
    expect(xOf('2026-06-16T12:00:00+07:00', snapshot.context, 10)).toBe(15);
  });
  it('puts vendor lanes above and client lanes below the trunk', () => {
    const l = layout();
    for (const lane of l.lanes)
      expect(lane.side === 'vendor' ? lane.y < l.trunkY : lane.y > l.trunkY).toBe(true);
  });
  it('packs branches so no two in a sub-row overlap within the gap', () => {
    const l = layout();
    const rows = new Map<string, { xStart: number; xEnd: number }[]>();
    for (const b of l.branches)
      rows.set(`${b.departmentId}:${b.row}`, [
        ...(rows.get(`${b.departmentId}:${b.row}`) ?? []),
        b,
      ]);
    for (const list of rows.values()) {
      list.sort((a, b) => a.xStart - b.xStart);
      for (let i = 1; i < list.length; i++)
        expect(list[i].xStart - list[i - 1].xEnd).toBeGreaterThanOrEqual(16);
    }
  });
  it('draws a ghost and slip path for the moved go-live milestone', () => {
    const goLive = layout().milestones.find((m) => m.label.startsWith('Go-live'))!;
    expect(goLive.ghostX).not.toBeNull();
    expect(goLive.ghostX!).toBeLessThan(goLive.x);
    expect(goLive.slipPath).toMatch(/^M/);
  });
  it('marks broken branches red with a marker and a text label in the accessible name', () => {
    const broken = layout().branches.filter((b) => b.tone === 'red');
    expect(broken.length).toBeGreaterThanOrEqual(5);
    for (const b of broken) {
      expect(b.breakdownMarkers.length).toBeGreaterThan(0);
      expect(b.accessibleName).toMatch(/Loop: .+, .+, .+/);
    }
  });
  it('switches zoom level by pxPerDay', () => {
    expect([layout(5).zoomLevel, layout(12).zoomLevel, layout(41).zoomLevel]).toEqual([
      'milestones',
      'branches',
      'detail',
    ]);
  });
  it('is deterministic', () => {
    expect(JSON.stringify(layout())).toBe(JSON.stringify(layout()));
  });
});

describe('layoutPromiseGraph design rules', () => {
  const branch = (title: string, l = layout()) => l.branches.find((b) => b.title === title)!;
  const milestone = (name: string, l = layout()) => l.milestones.find((m) => m.label === name)!;

  it('returns output that satisfies the layout contract', () => {
    expect(GraphLayoutSchema.safeParse(layout()).success).toBe(true);
  });
  it('orders lanes outward from the trunk by department order', () => {
    const l = layout();
    const vendor = l.lanes
      .filter((lane) => lane.side === 'vendor')
      .sort((a, b) => a.order - b.order);
    const client = l.lanes
      .filter((lane) => lane.side === 'client')
      .sort((a, b) => a.order - b.order);
    expect(vendor.map((lane) => lane.name)).toEqual([
      'Implementation',
      'Digitization',
      'Engineering',
      'Customer Success',
    ]);
    for (let i = 1; i < vendor.length; i++)
      expect(vendor[i].y + vendor[i].height).toBeLessThanOrEqual(vendor[i - 1].y);
    for (let i = 1; i < client.length; i++)
      expect(client[i].y).toBeGreaterThanOrEqual(client[i - 1].y + client[i - 1].height);
    for (const lane of l.lanes) expect(lane.height).toBe(Math.max(1, lane.subRows) * 28 + 12);
  });
  it('places each branch row inside its performer department lane', () => {
    const l = layout();
    for (const b of l.branches) {
      const lane = l.lanes.find((item) => item.departmentId === b.departmentId)!;
      expect(b.y).toBeGreaterThan(lane.y);
      expect(b.y).toBeLessThan(lane.y + lane.height);
      expect(b.row).toBeLessThan(lane.subRows);
    }
  });
  it('merges a closed loop at closedAt and draws accept as the merge point without a row glyph', () => {
    const loop = engine.loops.find((item) => item.loop.title === 'Kickoff agenda')!;
    const b = branch('Kickoff agenda');
    expect(b.endKind).toBe('merge');
    expect(b.tone).toBe('green');
    expect(b.xStart).toBe(Math.round(xOf(loop.firstActAt!, snapshot.context, 12) * 100) / 100);
    expect(b.xEnd).toBe(Math.round(xOf(loop.closedAt!, snapshot.context, 12) * 100) / 100);
    expect(b.glyphs.map((g) => g.type)).toEqual(['request', 'promise', 'report_done']);
    expect(b.glyphs.map((g) => g.glyph)).toEqual(['○', '●', '◐']);
    const r = (value: number) => Math.round(value * 100) / 100,
      trunkY = layout().trunkY;
    expect(b.path.startsWith(`M${r(b.xStart - 16)} ${trunkY} C`)).toBe(true);
    expect(b.path.endsWith(` ${r(b.xEnd + 16)} ${trunkY}`)).toBe(true);
  });
  it('turns a closed broken branch red from the breakdown start so the merge takes the red tone', () => {
    const loop = engine.loops.find((item) => item.loop.title === 'Subscription documents')!;
    const b = branch('Subscription documents');
    const startX = Math.round(xOf(loop.breakdowns[0].startAt, snapshot.context, 12) * 100) / 100;
    expect(b.tone).toBe('red');
    expect(b.segments.map((s) => [s.tone, s.style])).toEqual([
      ['green', 'solid'],
      ['red', 'solid'],
    ]);
    expect(b.segments[1].startX).toBe(startX);
    expect(b.breakdownMarkers).toEqual([{ x: startX, y: b.y, label: 'Late delivery' }]);
    expect(b.accessibleName).toBe('Loop: Subscription documents, Fund Operations, late delivery');
  });
  it('draws a warning-only hedged branch blue until the warning start, then amber and dashed', () => {
    const b = branch('Dynamics CRM sync scope');
    expect(b.tone).toBe('amber');
    expect(b.endKind).toBe('open');
    expect(b.segments.map((s) => [s.tone, s.style])).toEqual([
      ['blue', 'solid'],
      ['amber', 'dashed'],
    ]);
    expect(b.breakdownMarkers).toEqual([]);
    expect(b.xEnd).toBe(Math.round(xOf(engine.T, snapshot.context, 12) * 100) / 100);
    expect(b.accessibleName).toBe('Loop: Dynamics CRM sync scope, Engineering, ambiguous promise');
  });
  it('dots the segment that waits for a reply from the last act to T', () => {
    const loop = engine.loops.find((item) => item.loop.title === 'Client secret renewal')!;
    const b = branch('Client secret renewal');
    expect(b.tone).toBe('red');
    expect(b.segments.at(-1)).toEqual({
      startX: Math.round(xOf(loop.lastActAt!, snapshot.context, 12) * 100) / 100,
      endX: b.xEnd,
      style: 'dotted',
      tone: 'red',
    });
    expect(b.glyphs.map((g) => g.glyph)).toEqual(['○', '·']);
  });
  it('caps a declined branch in gray at the terminal act', () => {
    const input = fixture([{ type: 'request' }, { type: 'decline' }]);
    const l = layoutPromiseGraph(
      deriveProject(input),
      { context: input.snapshot.context },
      { pxPerDay: 20 },
    );
    const [b] = l.branches;
    expect(b.endKind).toBe('cap');
    expect(b.tone).toBe('gray');
    expect(b.xEnd).toBe(xOf('2026-10-06T12:00:00Z', input.snapshot.context, 20));
    expect(b.glyphs.map((g) => g.glyph)).toEqual(['○', '■']);
    expect(b.segments.every((s) => s.tone === 'gray' && s.style === 'solid')).toBe(true);
    expect(b.accessibleName).toBe('Loop: Mapping, Engineering, declined');
  });
  it('dots a negotiating branch that waits for an answer to a counter', () => {
    const input = fixture([{ type: 'request' }, { type: 'counter', due }], '2026-10-07T00:00:00Z');
    const [b] = layoutPromiseGraph(
      deriveProject(input),
      { context: input.snapshot.context },
      { pxPerDay: 20 },
    ).branches;
    expect(b.segments.map((s) => [s.style, s.startX, s.endX])).toEqual([
      ['solid', 90, 110],
      ['dotted', 110, 120],
    ]);
  });
  it('adds an amber due-soon tail from T to the due instant', () => {
    const input = fixture([{ type: 'promise', due }], '2026-10-08T12:00:00Z');
    const derived = deriveProject(input);
    expect(derived.loops[0].dueSoon).toBe(true);
    const [b] = layoutPromiseGraph(
      derived,
      { context: input.snapshot.context },
      { pxPerDay: 24 },
    ).branches;
    expect(b.tone).toBe('amber');
    expect(b.segments.map((s) => [s.tone, s.startX, s.endX])).toEqual([
      ['blue', 108, 180],
      ['amber', 180, 216],
    ]);
    expect(b.xEnd).toBe(216);
  });
  it('keeps the planned date of an unmoved milestone and centres milestones on their date', () => {
    const l = layout();
    expect(milestone('Kickoff', l).ghostX).toBeNull();
    expect(milestone('Kickoff', l).slipPath).toBeNull();
    expect(milestone('Go-live and first close', l).x).toBe(
      xOf('2026-10-15T12:00:00+07:00', snapshot.context, 12),
    );
    expect(milestone('Go-live and first close', l).ghostX).toBe(
      xOf('2026-09-30T12:00:00+07:00', snapshot.context, 12),
    );
    expect(milestone('Go-live and first close', l).accessibleName).toBe(
      'Milestone: Go-live and first close, moved from 2026-09-30 to 2026-10-15, at risk',
    );
    expect(milestone('Go-live and first close', l)).toMatchObject({
      openLoopCount: 3,
      brokenLoopCount: 2,
      y: l.trunkY,
    });
  });
  it('orders keyboard navigation by milestone time, then by branch start', () => {
    const l = layout();
    const ms = new Map(l.milestones.map((m) => [m.id, m.x]));
    const xs = l.navigation.milestoneIds.map((id) => ms.get(id)!);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(l.navigation.loopIds).toEqual(l.branches.map((b) => b.loopId));
    const starts = l.branches.map((b) => b.xStart);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(l.navigation.loopIds).toHaveLength(30);
  });
  it('labels glyphs with act type and person initials and names them for assistive technology', () => {
    const b = branch('Client secret renewal');
    expect(b.glyphs[0].label).toMatch(/^request [A-Z]{2}$/);
    expect(b.glyphs[0].accessibleName).toMatch(/^Request by .+, 2026-09-22 09:20$/);
    const input = fixture([{ type: 'request', actor: customer }]);
    const [g] = layoutPromiseGraph(
      deriveProject(input),
      { context: input.snapshot.context },
      { pxPerDay: 20 },
    ).branches[0].glyphs;
    expect(g).toMatchObject({
      label: 'request A',
      accessibleName: 'Request by Ada, 2026-10-05 12:00',
    });
  });
  it('handles a daylight saving day as a 23-hour day', () => {
    const context = {
      ...snapshot.context,
      timeZone: 'America/New_York',
      windowStart: '2026-03-07',
    };
    expect(xOf('2026-03-08T00:00:00-05:00', context, 10)).toBe(10);
    expect(xOf('2026-03-08T12:00:00-04:00', context, 10)).toBeCloseTo(10 + (10 * 11) / 23, 10);
    expect(xOf('2026-03-09T00:00:00-04:00', context, 10)).toBe(20);
  });

  it('draws a zero-act loop as a zero-length "no acts yet" branch at T', () => {
    for (const input of [fixture([]), fixture([{ type: 'request' }], '2026-10-03T00:00:00Z')]) {
      const derived = deriveProject(input);
      expect(derived.loops[0].acts).toEqual([]);
      const l = layoutPromiseGraph(derived, { context: input.snapshot.context }, { pxPerDay: 20 });
      const xT = xOf(input.T, input.snapshot.context, 20);
      expect(GraphLayoutSchema.safeParse(l).success).toBe(true);
      expect(l.branches).toHaveLength(1);
      expect(l.branches[0]).toMatchObject({
        xStart: xT,
        xEnd: xT,
        tone: 'blue',
        endKind: 'open',
        glyphs: [],
        breakdownMarkers: [],
        segments: [{ startX: xT, endX: xT, style: 'solid', tone: 'blue' }],
        accessibleName: 'Loop: Mapping, Engineering, no acts yet',
      });
      expect(l.navigation.loopIds).toEqual([derived.loops[0].loop.id]);
    }
  });
  it('keeps a zero-act loop in its lane and in start-order navigation beside other loops', () => {
    const extra = {
      ...snapshot.loops[0],
      id: '00000000-0000-4000-8000-0000000000aa',
      title: 'Empty loop',
    };
    const withEmpty = { ...snapshot, loops: [...snapshot.loops, extra] } as GraphSnapshot;
    const derived = deriveProject(
      engineInputFromFixtures(
        withEmpty,
        records.filter((r) => r.projectKey === 'larkspur'),
        gold.T,
      ),
    );
    const l = layoutPromiseGraph(derived, { context: snapshot.context }, { pxPerDay: 12 });
    expect(GraphLayoutSchema.safeParse(l).success).toBe(true);
    const b = l.branches.find((item) => item.loopId === extra.id)!;
    const lane = l.lanes.find((item) => item.departmentId === extra.performerDepartmentId)!;
    expect(b.xStart).toBe(Math.round(xOf(gold.T, snapshot.context, 12) * 100) / 100);
    expect(b.row).toBeLessThan(lane.subRows);
    expect(l.navigation.loopIds).toHaveLength(31);
    expect(l.navigation.loopIds).toEqual(l.branches.map((item) => item.loopId));
    const starts = l.branches.map((item) => item.xStart);
    expect(starts).toEqual([...starts].sort((a, c) => a - c));
  });
  it('turns a cancelled loop with a broken breakdown red from the breakdown start', () => {
    const input = fixture([
      { type: 'promise' },
      { type: 'report_done' },
      { type: 'reject' },
      { type: 'cancel' },
    ]);
    const derived = deriveProject(input);
    expect(derived.loops[0].state).toBe('cancelled');
    expect(derived.loops[0].breakdowns.map((item) => item.severity)).toContain('broken');
    const [b] = layoutPromiseGraph(
      derived,
      { context: input.snapshot.context },
      { pxPerDay: 20 },
    ).branches;
    const rejectX = xOf('2026-10-07T12:00:00Z', input.snapshot.context, 20);
    expect(b.tone).toBe('red');
    expect(b.endKind).toBe('cap');
    expect(b.segments.map((s) => [s.tone, s.startX, s.endX])).toEqual([
      ['gray', 90, rejectX],
      ['red', rejectX, 150],
    ]);
    expect(b.breakdownMarkers).toEqual([{ x: rejectX, y: b.y, label: 'Rejected delivery' }]);
  });
});
