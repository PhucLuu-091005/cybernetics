import { describe, expect, it } from 'vitest';
import {
  GEOMETRY,
  layoutTracker,
  type LayoutSegment,
  type TrackerLayout,
  type View,
} from '../../../src/tracker/layout';
import type { TrackerState } from '../../../src/tracker/model';
import { replayOps, type Marks } from '../../../src/tracker/ops';
import { addDays } from '../../../src/tracker/time';
import {
  AS_OF,
  TIME_ZONE,
  at,
  buildState,
  event,
  larkspurState,
  makeOp,
  workItem,
} from '../../support/tracker-fixture';

const { VW, X0, X1, SIDE, TRUNK_Y, MS_Y, AXIS_Y, TOP, INDENT } = GEOMETRY;

const view = (over: Partial<View> = {}): View => ({
  hiddenRows: new Set(),
  hiddenTeams: new Set(),
  asOf: AS_OF,
  timeZone: TIME_ZONE,
  windowStart: '2026-09-10',
  windowEnd: '2026-10-17',
  ...over,
});

const ms = (local: string) => Date.parse(at(local));
const midnight = (date: string) => Date.parse(`${date}T00:00:00+07:00`);
// A deadline without a time is the last moment of its day.
const dayEnd = (date: string) => midnight(addDays(date, 1)) - 1;

const lines = (L: TrackerLayout, id: string) =>
  L.segments.filter(
    (s): s is Extract<LayoutSegment, { kind: 'line' }> => s.workItemId === id && s.kind === 'line',
  );

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const noMarks = (): Marks => ({
  workItems: new Set(),
  events: new Set(),
  milestones: new Set(),
  dates: new Set(),
});

describe('layoutTracker: scale and window', () => {
  const L = layoutTracker(larkspurState(), view());

  it('maps the window from the label column to the right edge, with no milestone chip column', () => {
    expect(L.zoom).toBe(1);
    expect(L).not.toHaveProperty('rail');
    expect(L).not.toHaveProperty('msChips');
    expect(L.x1).toBe(X1);
    expect(L.width).toBe(VW);
    expect(L.x(midnight('2026-09-10'))).toBeCloseTo(X0, 9);
    expect(L.x(midnight('2026-10-17'))).toBeCloseTo(X1, 9);
    expect(L.window).toMatchObject({
      start: '2026-09-10',
      end: '2026-10-17',
      startMs: midnight('2026-09-10'),
      endMs: midnight('2026-10-17'),
      label: 'Work items from 10 Sept to 16 Oct',
    });
  });

  it('keeps x(t) and t(x) inverse within 1 ms', () => {
    for (const t of [midnight('2026-09-10'), Date.parse(AS_OF), ms('2026-09-24T09:20')]) {
      expect(Math.abs(L.t(L.x(t)) - t)).toBeLessThan(1);
    }
    for (const x of [X0, 400.5, 777.25, X1]) expect(L.x(L.t(x))).toBeCloseTo(x, 6);
  });

  it('draws a grid tick every 7 days from the first Monday and hides labels near the T line', () => {
    expect(L.ticks.map((t) => t.date)).toEqual([
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
    ]);
    expect(L.ticks.map((t) => t.labelled)).toEqual([true, true, true, true, false]);
    expect(L.ticks[0]).toMatchObject({ label: '14 Sept', x: L.x(midnight('2026-09-14')) });
  });

  it('puts the T line at asOf', () => {
    expect(L.tLine).toEqual({
      x: L.x(Date.parse(AS_OF)),
      y1: AXIS_Y + 5,
      y2: L.height,
      label: 'T 9 Oct 18:00',
    });
  });

  it('defaults the window to 3 days before the earliest relevant start and past the plans', () => {
    const D = layoutTracker(
      larkspurState(),
      view({ windowStart: undefined, windowEnd: undefined }),
    );
    expect(D.window.start).toBe('2026-06-29');
    expect(D.window.end).toBe('2026-10-19');
  });

  it('ignores items finished more than 60 days ago for the default start', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      workItems: [
        workItem({ id: 'old', teamId: 't', plannedFinish: '2026-07-01' }),
        workItem({ id: 'recent', teamId: 't', plannedFinish: '2026-09-01' }),
        workItem({ id: 'open', teamId: 't', plannedFinish: '2026-10-10' }),
      ],
      events: [
        event({ id: 'o1', workItemId: 'old', at: at('2026-06-20T09:00') }),
        event({ id: 'o2', workItemId: 'old', kind: 'done', at: at('2026-07-01T09:00') }),
        event({ id: 'r1', workItemId: 'recent', at: at('2026-08-25T09:00') }),
        event({ id: 'r2', workItemId: 'recent', kind: 'done', at: at('2026-09-01T09:00') }),
        event({ id: 'n1', workItemId: 'open', at: at('2026-09-20T09:00') }),
      ],
    });
    const D = layoutTracker(s, view({ windowStart: undefined, windowEnd: undefined }));
    expect(D.window.start).toBe('2026-08-22');
    expect(D.window.end).toBe('2026-10-16');
    expect(D.rows.map((r) => r.id)).toEqual(['recent', 'open']);
  });

  it('starts an empty project 3 days before asOf', () => {
    const D = layoutTracker(buildState(), view({ windowStart: undefined, windowEnd: undefined }));
    expect(D.window.start).toBe('2026-10-06');
    expect(D.window.end).toBe('2026-10-16');
  });

  it('gives the same width to the time line with or without milestones', () => {
    const D = layoutTracker(buildState(), view());
    expect(D.x1).toBe(X1);
    expect(D.width).toBe(VW);
  });

  it('keeps the axis and the milestone line above the first lane, so they can stay pinned', () => {
    expect(L.lanes[0].top).toBe(TOP);
    expect(Math.max(...L.milestones.map((m) => m.labelY))).toBeLessThanOrEqual(TOP - 2);
  });
});

describe('layoutTracker: time zoom', () => {
  const fit = layoutTracker(larkspurState(), view());
  const Z = layoutTracker(larkspurState(), view({ zoom: 3 }));

  it('widens the time line by the zoom factor and keeps the label column', () => {
    const plot = X1 - X0;
    expect(Z.zoom).toBe(3);
    expect(Z.x1).toBeCloseTo(X0 + plot * 3, 9);
    expect(Z.width).toBeCloseTo(Z.x1 + (VW - X1), 9);
    expect(Z.x(midnight('2026-09-10'))).toBeCloseTo(X0, 9);
    expect(Z.x(midnight('2026-10-17'))).toBeCloseTo(Z.x1, 9);
    expect(Z.rows.map((r) => r.y)).toEqual(fit.rows.map((r) => r.y));
    expect(Z.height).toBe(fit.height);
    expect(Z.trunk).toEqual({ x1: X0, x2: Z.x1, y: TRUNK_Y });
    for (const t of [Date.parse(AS_OF), ms('2026-09-24T09:20')])
      expect(Math.abs(Z.t(Z.x(t)) - t)).toBeLessThan(1);
  });

  it('keeps the zoom between fit and 12 times', () => {
    expect(layoutTracker(larkspurState(), view({ zoom: 0.4 })).zoom).toBe(1);
    expect(layoutTracker(larkspurState(), view({ zoom: 40 })).zoom).toBe(GEOMETRY.MAX_ZOOM);
    expect(GEOMETRY.MAX_ZOOM).toBe(12);
    expect(layoutTracker(larkspurState(), view({ zoom: Number.NaN })).zoom).toBe(1);
  });

  it('separates a stack when the zoom puts its events 16 units apart', () => {
    const groups = (L: TrackerLayout) =>
      L.eventGroups.filter((g) => g.workItemId === 'rehearsal').map((g) => g.eventIds);
    expect(groups(fit)).toEqual([['r1', 'r2', 'r3']]);
    expect(groups(Z)).toEqual([['r1', 'r2', 'r3']]);
    expect(groups(layoutTracker(larkspurState(), view({ zoom: 4 })))).toEqual([
      ['r1'],
      ['r2', 'r3'],
    ]);
  });

  it('draws a tick every day once a day is wide enough for its label', () => {
    const wide = layoutTracker(larkspurState(), view({ zoom: 6 }));
    expect(wide.ticks.slice(0, 3).map((t) => t.date)).toEqual([
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
    expect(wide.ticks).toHaveLength(36);
    const two = layoutTracker(larkspurState(), view({ zoom: 2 }));
    expect(two.ticks.map((t) => t.date)).toEqual(fit.ticks.map((t) => t.date));
  });
});

describe('layoutTracker: day offsets', () => {
  const groups = (L: TrackerLayout) =>
    L.eventGroups.filter((g) => g.workItemId === 'rehearsal').map((g) => g.eventIds);

  it('draws an event at its time plus the offset of the viewer', () => {
    const L = layoutTracker(larkspurState(), view({ offsets: { p31: 120 } }));
    expect(L.eventGroups.find((g) => g.topId === 'p31')?.x).toBeCloseTo(
      L.x(ms('2026-09-24T11:20')),
      9,
    );
  });

  it('keeps the real time in the tooltip and the label', () => {
    const L = layoutTracker(larkspurState(), view({ offsets: { p31: 120 } }));
    expect(L.eventGroups.find((g) => g.topId === 'p31')).toMatchObject({
      ariaLabel: 'Task by Lan Phạm, 24 Sept 09:20',
      tooltip:
        'Task · Lan Phạm · 24 Sept 09:20\nAdd a multi-select country list field. Target: 6 October.',
    });
  });

  it('stops a drawn event at the start and the end of its day', () => {
    const L = layoutTracker(larkspurState(), view({ offsets: { p31: 5000, p32: -5000 } }));
    const p32 = larkspurState().events.find((e) => e.id === 'p32')!;
    const day = p32.at.slice(0, 10);
    expect(L.eventGroups.find((g) => g.topId === 'p31')?.x).toBeCloseTo(
      L.x(ms('2026-09-24T23:59')),
      9,
    );
    expect(L.eventGroups.find((g) => g.topId === 'p32')?.x).toBeCloseTo(L.x(midnight(day)), 9);
  });

  it('stacks by the drawn x, so offsets pull a stack apart', () => {
    const offsets = { r1: -560, r3: 439 };
    expect(groups(layoutTracker(larkspurState(), view({ zoom: 3 })))).toEqual([['r1', 'r2', 'r3']]);
    expect(groups(layoutTracker(larkspurState(), view({ zoom: 3, offsets })))).toEqual([
      ['r1'],
      ['r2'],
      ['r3'],
    ]);
  });

  it('orders a stack by the drawn time, so the top event is the one drawn last', () => {
    const L = layoutTracker(larkspurState(), view({ zoom: 4, offsets: { r1: -560, r2: 50 } }));
    expect(
      L.eventGroups.filter((g) => g.workItemId === 'rehearsal').map((g) => g.eventIds),
    ).toEqual([['r1'], ['r2', 'r3']]);
    expect(L.eventGroups.find((g) => g.topId === 'r3')?.x).toBeCloseTo(
      L.x(ms('2026-09-24T16:40')),
      9,
    );
  });

  it('never draws an earlier event right of a later one on the same row and day', () => {
    const L = layoutTracker(larkspurState(), view({ zoom: 6, offsets: { r1: 600, r3: -400 } }));
    const rehearsal = L.eventGroups.filter((g) => g.workItemId === 'rehearsal');
    expect(rehearsal).toHaveLength(1);
    expect(rehearsal[0]).toMatchObject({
      eventIds: ['r1', 'r2', 'r3'],
      topId: 'r3',
      x: L.x(ms('2026-09-24T19:20')),
    });
  });
});

describe('layoutTracker: lanes and rows', () => {
  it('lists 7 lanes in team order', () => {
    const L = layoutTracker(larkspurState(), view());
    expect(L.lanes.map((l) => l.name)).toEqual([
      'Implementation',
      'Digitization',
      'Solutions Engineering',
      'Engineering',
      'Digitization QA',
      'Customer Success',
      'IT',
    ]);
    expect(L.lanes.map((l) => l.alt)).toEqual([false, true, false, true, false, true, false]);
    expect(L.lanes[0]).toMatchObject({
      teamId: 'implementation',
      label: 'IMPLEMENTATION',
      top: TRUNK_Y + 16,
      bottom: 188,
      guide: { y1: TRUNK_Y + 36, y2: 166 },
      eyeLabel: 'Hide Implementation',
    });
    expect(L.lanes[0]).not.toHaveProperty('more');
    expect(L.lanes[0]).not.toHaveProperty('hidden');
    expect(L.lanes[0]).not.toHaveProperty('count');
    expect(L.lanes[0]).not.toHaveProperty('hiddenCount');
  });

  it('gives one row per visible work item and drops items finished before the window', () => {
    const L = layoutTracker(larkspurState(), view());
    expect(L.rows.map((r) => [r.id, r.y])).toEqual([
      ['golive', 102],
      ['crs', 134],
      ['rehearsal', 166],
      ['analyse', 226],
      ['pg201', 286],
      ['pg202', 318],
      ['dynamics', 378],
      ['syncmon', 410],
      ['crmlive', 442],
      ['pg203', 474],
      ['test', 534],
      ['incident', 594],
      ['secret', 654],
    ]);
    expect(L.rows.every((r) => !r.changed)).toBe(true);
    expect(L.rows.find((r) => r.id === 'crs')).toMatchObject({
      title: 'CRS tax residency section with DealCloud sync',
      label: 'CRS tax residency section…',
      teamId: 'implementation',
      done: false,
      status: 'planned',
      milestoneId: 'golive',
      eyeLabel: 'Hide CRS tax residency section with DealCloud sync',
      focused: false,
      focusLabel: 'Focus on CRS tax residency section with DealCloud sync',
      depth: 0,
      dimmed: false,
    });
    const withButtons = layoutTracker(larkspurState(), view({ focusButtons: true }));
    expect(withButtons.rows.find((r) => r.id === 'crs')!.label).toBe('CRS tax residency secti…');
    expect(L.height).toBe(732);
  });

  it('drops a hidden team completely: no head line, no rows, no drop target', () => {
    const all = layoutTracker(larkspurState(), view());
    const L = layoutTracker(larkspurState(), view({ hiddenTeams: new Set(['engineering']) }));
    const engineering = ['dynamics', 'syncmon', 'crmlive', 'pg203'];
    const lane = all.lanes.find((l) => l.teamId === 'engineering')!;
    expect(L.lanes.map((l) => l.teamId)).not.toContain('engineering');
    expect(L.rows.some((r) => engineering.includes(r.id))).toBe(false);
    expect(L.segments.some((s) => engineering.includes(s.workItemId))).toBe(false);
    expect(L.eventGroups.some((g) => engineering.includes(g.workItemId))).toBe(false);
    expect(L.deadlines.some((d) => engineering.includes(d.workItemId))).toBe(false);
    expect(L.laneDrops.map((d) => d.teamId)).not.toContain('engineering');
    const height = lane.bottom - lane.top;
    expect(L.lanes.find((l) => l.teamId === 'digitization-qa')!.top).toBe(lane.top);
    expect(L.rows.find((r) => r.id === 'test')!.y).toBe(534 - height);
    expect(L.height).toBe(all.height - height);
    expect(L).not.toHaveProperty('folds');
  });

  it('keeps lanes alternating after a lane drops out', () => {
    const L = layoutTracker(larkspurState(), view({ hiddenTeams: new Set(['digitization']) }));
    expect(L.lanes.map((l) => l.alt)).toEqual([false, true, false, true, false, true]);
  });

  it('drops a hidden row completely and counts it on its lane', () => {
    const L = layoutTracker(larkspurState(), view({ hiddenRows: new Set(['pg203']) }));
    expect(L.rows.some((r) => r.id === 'pg203')).toBe(false);
    expect(L.segments.some((s) => s.workItemId === 'pg203')).toBe(false);
    expect(L.rows.find((r) => r.id === 'test')!.y).toBe(534 - 32);
    expect(L.height).toBe(732 - 32);
  });

  it('drops a team whose rows are all hidden, and keeps its full name on other lanes', () => {
    const all = layoutTracker(larkspurState(), view());
    const L = layoutTracker(larkspurState(), view({ hiddenRows: new Set(['pg201', 'pg202']) }));
    const lane = all.lanes.find((l) => l.teamId === 'solutions-engineering')!;
    expect(L.lanes.map((l) => l.teamId)).not.toContain('solutions-engineering');
    expect(L.height).toBe(all.height - (lane.bottom - lane.top));
    expect(lane.label).toBe('SOLUTIONS ENGINEERING');
  });

  it('offers a drop target on each visible lane', () => {
    const L = layoutTracker(larkspurState(), view());
    expect(L.laneDrops).toHaveLength(7);
    expect(L.laneDrops[0]).toEqual({
      teamId: 'implementation',
      x: X0,
      y: TRUNK_Y + 18,
      width: X1 - X0,
      height: 18,
      text: 'Drop here: Implementation',
      textX: X0 + 10,
      textY: TRUNK_Y + 31,
    });
  });

  it('gives an empty lane room for drops', () => {
    const s = buildState({ teams: [{ id: 't', name: 'Team', leadId: null }] });
    const L = layoutTracker(s, view());
    expect(L.lanes[0]).toMatchObject({ top: 64, bottom: 64 + 22 + 18 + 6, guide: null });
  });
});

describe('layoutTracker: the row tree', () => {
  const s = buildState({
    teams: [{ id: 't', name: 'Team', leadId: null }],
    workItems: [
      workItem({ id: 'kid', teamId: 't', parentId: 'top' }),
      workItem({ id: 'other', teamId: 't' }),
      workItem({ id: 'top', teamId: 't' }),
      workItem({ id: 'grandkid', teamId: 't', parentId: 'kid' }),
      workItem({ id: 'far', teamId: 'u', parentId: 'top' }),
    ],
  });
  s.teams.push({ id: 'u', name: 'Other team', leadId: null });

  it('puts children under their parent inside a team and indents them', () => {
    const L = layoutTracker(s, view());
    expect(L.rows.map((r) => [r.id, r.depth])).toEqual([
      ['other', 0],
      ['top', 0],
      ['kid', 1],
      ['grandkid', 2],
      ['far', 0],
    ]);
    expect(INDENT).toBe(12);
  });

  it('puts a child at the top level when its parent is hidden', () => {
    const L = layoutTracker(s, view({ hiddenRows: new Set(['top']) }));
    expect(L.rows.map((r) => [r.id, r.depth])).toEqual([
      ['kid', 0],
      ['grandkid', 1],
      ['other', 0],
      ['far', 0],
    ]);
  });
});

describe('layoutTracker: segments and waits', () => {
  const L = layoutTracker(larkspurState(), view());

  it('turns PG-203 danger after 7 Oct (planned 6 Oct, still open)', () => {
    const segs = lines(L, 'pg203');
    expect(segs.map((s) => s.tone)).toEqual(['route', 'danger']);
    expect(segs[0].x1).toBeCloseTo(L.x(ms('2026-09-24T09:20')), 9);
    expect(segs[0].x2).toBeCloseTo(L.x(midnight('2026-10-07')), 9);
    expect(segs[1].x1).toBeCloseTo(L.x(midnight('2026-10-07')), 9);
    expect(segs[1].x2).toBeCloseTo(L.x(Date.parse(AS_OF)), 9);
    expect(segs[1].y).toBe(474);
  });

  it('shows PG-202 caution after its planned day (finished late)', () => {
    const segs = lines(L, 'pg202');
    expect(segs.map((s) => s.tone)).toEqual(['proceed', 'caution']);
    expect(segs[1].x1).toBeCloseTo(L.x(midnight('2026-10-02')), 9);
    expect(segs[1].x2).toBeCloseTo(L.x(ms('2026-10-02T16:40')), 9);
  });

  it('draws one blue or green line for items inside their plan', () => {
    expect(lines(L, 'crs').map((s) => s.tone)).toEqual(['route']);
    expect(lines(L, 'pg201').map((s) => s.tone)).toEqual(['proceed']);
  });

  it('starts a line that began before the window at the label column', () => {
    const [seg] = lines(L, 'dynamics');
    expect(seg.x1).toBe(X0);
  });

  it('draws no connector line: no stems from the trunk or a parent, no leads-from curves', () => {
    expect(L).not.toHaveProperty('stems');
    expect(L).not.toHaveProperty('links');
  });

  it('draws a waiting line with the open items it waits for', () => {
    const wait = L.segments.find((s) => s.workItemId === 'test');
    const sx = L.x(ms('2026-10-02T16:40'));
    expect(wait).toEqual({
      kind: 'wait',
      workItemId: 'test',
      x1: sx,
      x2: L.x(Date.parse(AS_OF)),
      y: 534,
      tone: 'ink-3',
      text: 'Waiting for PG-203',
      textX: sx + 8,
      textY: 534 - 7,
    });
  });

  it('writes No events yet when nothing blocks an empty item', () => {
    const s = larkspurState();
    s.workItems.find((w) => w.id === 'test')!.after = [];
    const wait = layoutTracker(s, view()).segments.find((x) => x.workItemId === 'test');
    expect(wait).toMatchObject({ kind: 'wait', text: 'No events yet' });
  });

  it('starts an empty item placed after asOf at the T line', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      workItems: [
        workItem({ id: 'src', teamId: 't' }),
        workItem({ id: 'placed', teamId: 't', since: at('2026-10-12T09:00') }),
        workItem({ id: 'led', teamId: 't', after: ['src'], since: at('2026-10-12T09:00') }),
      ],
      events: [
        event({ id: 's1', workItemId: 'src', at: at('2026-09-20T09:00') }),
        event({ id: 's2', workItemId: 'src', kind: 'done', at: at('2026-10-02T16:40') }),
      ],
    });
    const L = layoutTracker(s, view());
    const xt = L.x(Date.parse(AS_OF));
    expect(L.segments.find((x) => x.workItemId === 'placed')).toMatchObject({ x1: xt });
    expect(L.segments.find((x) => x.workItemId === 'led')).toMatchObject({ x1: xt });
  });

  it('starts an empty item placed before asOf at the later of since and its finished source', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      workItems: [
        workItem({ id: 'src', teamId: 't' }),
        workItem({ id: 'led', teamId: 't', after: ['src'], since: at('2026-09-25T09:00') }),
      ],
      events: [
        event({ id: 's1', workItemId: 'src', at: at('2026-09-20T09:00') }),
        event({ id: 's2', workItemId: 'src', kind: 'done', at: at('2026-10-02T16:40') }),
      ],
    });
    const L = layoutTracker(s, view());
    expect(L.segments.find((x) => x.workItemId === 'led')).toMatchObject({
      x1: L.x(ms('2026-10-02T16:40')),
    });
  });

  it('gives a row with a hidden parent a chip', () => {
    const H = layoutTracker(larkspurState(), view({ hiddenRows: new Set(['crs']) }));
    const y = H.rows.find((r) => r.id === 'analyse')!.y;
    const sx = H.x(ms('2026-09-15T13:00'));
    expect(H.chips.find((c) => c.workItemId === 'analyse')).toEqual({
      workItemId: 'analyse',
      sources: ['crs'],
      ariaLabel: 'Show CRS tax residency section with DealCloud sync',
      tooltip: 'From CRS tax residency section with DealCloud sync (hidden)',
      x: sx - 22,
      y: y - 7,
      size: 14,
    });
  });

  it('gives the chip to the direct children only, not to rows that lead from a shown child', () => {
    const H = layoutTracker(larkspurState(), view({ hiddenRows: new Set(['crs']) }));
    expect(H.chips.map((c) => c.workItemId)).toEqual(['analyse']);
  });

  it('gives the chip of a parent in a hidden team to its direct children only', () => {
    const H = layoutTracker(larkspurState(), view({ hiddenTeams: new Set(['implementation']) }));
    expect(H.chips.find((c) => c.workItemId === 'analyse')?.sources).toEqual(['crs']);
    expect(H.chips.some((c) => c.workItemId === 'pg203')).toBe(false);
  });
});

describe('layoutTracker: events and milestone ticks', () => {
  const state = larkspurState();
  const L = layoutTracker(state, view());

  it('groups events closer than 16 units and lists every id, top event last', () => {
    const rehearsal = L.eventGroups.filter((g) => g.workItemId === 'rehearsal');
    expect(rehearsal).toHaveLength(1);
    expect(rehearsal[0]).toMatchObject({
      eventIds: ['r1', 'r2', 'r3'],
      topId: 'r3',
      kind: 'done',
      x: L.x(ms('2026-09-24T16:40')),
      y: 166,
      tone: 'proceed',
      changed: false,
      ariaLabel: '3 events, the last: Done by Sarah Kim, 24 Sept 16:40',
      tooltip: 'Done · Sarah Kim · 24 Sept 16:40\nSarah accepts the rehearsal.\n3 events here',
    });
    expect(L.eventGroups.find((g) => g.topId === 'p31')).toMatchObject({
      eventIds: ['p31'],
      ariaLabel: 'Task by Lan Phạm, 24 Sept 09:20',
      tooltip:
        'Task · Lan Phạm · 24 Sept 09:20\nAdd a multi-select country list field. Target: 6 October.',
    });
    expect(L.eventGroups.filter((g) => g.workItemId === 'analyse').map((g) => g.eventIds)).toEqual([
      ['a1'],
      ['a2'],
      ['a3', 'a4'],
    ]);
  });

  it('skips events before the window', () => {
    expect(L.eventGroups.filter((g) => g.workItemId === 'golive').map((g) => g.eventIds)).toEqual([
      ['g3'],
      ['g4'],
    ]);
    expect(L.eventGroups.some((g) => g.workItemId === 'dynamics')).toBe(false);
  });

  it('colours an event after the planned finish red while open', () => {
    const pg203 = L.eventGroups.filter((g) => g.workItemId === 'pg203');
    expect(pg203.map((g) => [g.topId, g.tone])).toEqual([
      ['p31', 'route'],
      ['p32', 'danger'],
    ]);
    const pg202 = L.eventGroups.filter((g) => g.workItemId === 'pg202');
    expect(pg202.map((g) => g.tone)).toEqual(['proceed', 'caution']);
  });

  it('draws no mark for the own planned finish of a work item', () => {
    expect(L).not.toHaveProperty('dueMarks');
  });
});

describe('layoutTracker: milestone deadlines on member rows', () => {
  const L = layoutTracker(larkspurState(), view());
  const mark = (id: string) => L.deadlines.find((d) => d.workItemId === id);

  it('marks the deadline on every member row, done or open, passed or not', () => {
    expect(L.deadlines.map((d) => [d.workItemId, d.milestoneId])).toEqual([
      ['golive', 'golive'],
      ['crs', 'golive'],
      ['rehearsal', 'golive'],
      ['dynamics', 'crm'],
      ['syncmon', 'crm'],
      ['crmlive', 'crm'],
      ['incident', 'golive'],
      ['secret', 'golive'],
    ]);
    expect(L).not.toHaveProperty('goalTicks');
  });

  it('takes the milestone status colour and names the milestone in its tooltip', () => {
    expect(mark('rehearsal')).toMatchObject({
      date: '2026-09-30',
      x: L.x(dayEnd('2026-09-30')),
      y: 166,
      tone: 'danger',
      stroke: 'danger',
      filled: true,
      changed: false,
      ariaLabel: 'Go-live and first close · deadline 30 Sept · Late',
      tooltip: 'Go-live and first close · deadline 30 Sept · Late',
    });
    expect(mark('rehearsal')!.x).toBe(L.milestones.find((m) => m.id === 'golive')!.x);
    expect(mark('secret')).toMatchObject({
      ariaLabel: 'Go-live and first close · deadline 30 Sept · Late, this work item makes it late',
      tooltip: 'Go-live and first close · deadline 30 Sept · Late\nThis work item makes it late.',
    });
  });

  it('says when a done row finished after the deadline', () => {
    const s = larkspurState();
    s.events.push(
      event({ id: 'late', workItemId: 'incident', kind: 'done', at: at('2026-10-05T10:00') }),
    );
    expect(
      layoutTracker(s, view()).deadlines.find((d) => d.workItemId === 'incident'),
    ).toMatchObject({
      tooltip:
        'Go-live and first close · deadline 30 Sept · Late\nThis work item finished after it.',
    });
  });

  it('draws a planned milestone hollow and a finished one filled', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      milestones: [
        {
          id: 'm',
          name: 'Portal live',
          planned: '2026-10-12',
          firstPlanned: '2026-10-12',
          moves: [],
        },
        { id: 'n', name: 'Docs', planned: '2026-09-20', firstPlanned: '2026-09-20', moves: [] },
      ],
      workItems: [
        workItem({ id: 'open', teamId: 't', milestoneId: 'm' }),
        workItem({ id: 'done', teamId: 't', milestoneId: 'n' }),
      ],
      events: [event({ id: 'd1', workItemId: 'done', kind: 'done', at: at('2026-09-18T09:00') })],
    });
    const M = layoutTracker(s, view());
    expect(M.deadlines.map((d) => [d.workItemId, d.tone, d.filled])).toEqual([
      ['open', 'ink-3', false],
      ['done', 'teal', true],
    ]);
    expect(M.deadlines[0].tooltip).toBe('Portal live · deadline 12 Oct · Planned');
  });

  const labelled = (over: { [id: string]: Partial<Parameters<typeof workItem>[0]> } = {}) => {
    const ms = (id: string, name: string, planned: string) => ({
      id,
      name,
      planned,
      firstPlanned: planned,
      moves: [],
    });
    return buildState({
      teams: [
        { id: 't', name: 'Team', leadId: null },
        { id: 'u', name: 'Other', leadId: null },
      ],
      milestones: [
        ms('m', 'Portal live and first close', '2026-10-12'),
        ms('z', 'Final sign off', '2026-10-16'),
      ],
      workItems: [
        workItem({ id: 'first', teamId: 't', milestoneId: 'm', ...over.first }),
        workItem({ id: 'second', teamId: 't', milestoneId: 'm' }),
        workItem({ id: 'other', teamId: 'u', milestoneId: 'm' }),
        workItem({ id: 'edge', teamId: 'u', milestoneId: 'z' }),
      ],
    });
  };

  it('names the milestone in full once per team, on the first member row of that team', () => {
    const M = layoutTracker(labelled(), view({ zoom: 4 }));
    const d = (id: string) => M.deadlines.find((x) => x.workItemId === id)!;
    expect(d('first')).toMatchObject({
      label: 'Portal live and first close',
      labelAnchor: 'start',
      labelX: d('first').x + 9,
    });
    expect(d('second').label).toBeNull();
    expect(d('other').label).toBe('Portal live and first close');
  });

  it('puts the name left of the mark when the right side has no room', () => {
    const M = layoutTracker(labelled(), view({ zoom: 4 }));
    const edge = M.deadlines.find((x) => x.workItemId === 'edge')!;
    expect(edge).toMatchObject({ label: 'Final sign off', labelAnchor: 'end', labelX: edge.x - 9 });
  });

  it('keeps the name inside its own row band', () => {
    const M = layoutTracker(labelled(), view({ zoom: 4 }));
    for (const d of M.deadlines) {
      expect(d.labelY - 9).toBeGreaterThanOrEqual(d.y - GEOMETRY.ROW / 2);
      expect(d.labelY).toBeLessThanOrEqual(d.y);
    }
  });

  it('gives no name when the first member row has no free room, and no other row takes it', () => {
    const s = labelled();
    s.events.push(
      event({ id: 'b1', workItemId: 'first', at: at('2026-10-12T15:00') }),
      event({ id: 'b2', workItemId: 'first', at: at('2026-10-13T08:00') }),
    );
    const M = layoutTracker(s, view({ zoom: 4 }));
    expect(M.deadlines.find((x) => x.workItemId === 'first')!.label).toBeNull();
    expect(M.deadlines.find((x) => x.workItemId === 'second')!.label).toBeNull();
  });

  it('draws no deadline for a milestone before the window', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      milestones: [
        { id: 'old', name: 'Old', planned: '2026-09-01', firstPlanned: '2026-09-01', moves: [] },
      ],
      workItems: [workItem({ id: 'a', teamId: 't', milestoneId: 'old' })],
      events: [event({ id: 'a1', workItemId: 'a', at: at('2026-09-20T09:00') })],
    });
    const M = layoutTracker(s, view());
    expect(M.rows.map((r) => r.id)).toEqual(['a']);
    expect(M.deadlines).toEqual([]);
  });

  it('keeps the mark inside the time line', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      milestones: [
        { id: 'm', name: 'M', planned: '2026-12-01', firstPlanned: '2026-12-01', moves: [] },
      ],
      workItems: [workItem({ id: 'a', teamId: 't', milestoneId: 'm' })],
    });
    const M = layoutTracker(s, view());
    expect(M.deadlines[0].x).toBe(M.x1 - 4);
  });
});

describe('layoutTracker: a milestone deadline with a time', () => {
  const busyDay = (plannedTime?: string) =>
    buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      milestones: [
        {
          id: 'm',
          name: 'Client call',
          planned: '2026-10-08',
          ...(plannedTime ? { plannedTime } : {}),
          firstPlanned: '2026-10-08',
          moves: [],
        },
      ],
      workItems: [
        workItem({ id: 'a', teamId: 't', milestoneId: 'm', plannedFinish: '2026-10-09' }),
      ],
      events: [
        event({ id: 'e1', workItemId: 'a', at: at('2026-10-08T09:00') }),
        event({ id: 'e2', workItemId: 'a', at: at('2026-10-08T16:00') }),
        event({ id: 'e3', workItemId: 'a', kind: 'done', at: at('2026-10-08T18:00') }),
      ],
    });
  const xs = (L: TrackerLayout) =>
    Object.fromEntries(
      L.eventGroups.flatMap((g) => g.eventIds.map((id) => [id, g.x] as const)),
    ) as Record<string, number>;

  it('puts the diamond and the milestone circle at the time on the project clock', () => {
    const L = layoutTracker(busyDay('17:00'), view({ zoom: 12 }));
    const x = L.x(ms('2026-10-08T17:00'));
    expect(L.deadlines[0]).toMatchObject({ date: '2026-10-08', time: '17:00', x });
    expect(L.milestones[0].x).toBe(x);
    expect(L.milestones[0].label).toBe('Client call · 8 Oct 17:00 · Finished late');
    expect(L.deadlines[0].tooltip).toBe(
      'Client call · deadline 8 Oct 17:00 · Finished late\nThis work item finished after it.',
    );
    const at = xs(L);
    expect(at.e2).toBeLessThan(x);
    expect(at.e3).toBeGreaterThan(x);
  });

  it('puts a deadline without a time after every event of its day', () => {
    const L = layoutTracker(busyDay(), view({ zoom: 12 }));
    const x = L.x(dayEnd('2026-10-08'));
    expect(L.deadlines[0]).toMatchObject({ time: null, x });
    expect(L.milestones[0].x).toBe(x);
    expect(L.deadlines[0].tooltip).toBe('Client call · deadline 8 Oct · Finished on time');
    expect(Math.max(...Object.values(xs(L)))).toBeLessThan(x);
  });

  it('keeps moved events on their own side of the deadline', () => {
    const L = layoutTracker(busyDay('17:00'), view({ zoom: 12, offsets: { e2: 180, e3: -300 } }));
    const x = L.x(ms('2026-10-08T17:00'));
    const at = xs(L);
    expect(at.e2).toBeLessThanOrEqual(x);
    expect(at.e3).toBeGreaterThanOrEqual(x);
  });

  it('names the old time in the moved label of a changed milestone', () => {
    const base = busyDay('17:00');
    const { state, marks } = replayOps(base, [
      makeOp('msDate', {
        milestoneId: 'm',
        date: '2026-10-09',
        why: 'The client moved the call.',
        by: 'minh',
        at: at('2026-10-08T12:00'),
      }),
    ]);
    const L = layoutTracker(state, view(), marks);
    expect(L.milestones[0].label).toBe('Client call · 9 Oct · Finished early (was 8 Oct 17:00)');
  });
});

describe('layoutTracker: handoff marks and chips', () => {
  const L = layoutTracker(larkspurState(), view());
  const twoTeams = (
    items: Parameters<typeof workItem>[0][],
    events: Parameters<typeof event>[0][],
  ): TrackerState =>
    buildState({
      teams: [
        { id: 't1', name: 'One', leadId: null },
        { id: 't2', name: 'Two', leadId: null },
      ],
      workItems: items.map(workItem),
      events: events.map(event),
    });

  it('puts one mark at the finish of a source for all the work items it leads to', () => {
    const fx = L.x(ms('2026-09-22T16:40'));
    const marks = L.handoffs.filter((h) => h.fromId === 'analyse');
    expect(marks).toHaveLength(1);
    const lines = [
      'Handed over to Solutions Engineering · received in PG-201 CRS form logic',
      'Handed over to Solutions Engineering · received in PG-202 DealCloud mapping for CRS fields',
      'Handed over to Engineering · received in PG-203 Country list field type',
    ];
    expect(marks[0]).toEqual({
      fromId: 'analyse',
      targets: [
        {
          id: 'pg201',
          teamId: 'solutions-engineering',
          team: 'Solutions Engineering',
          title: 'PG-201 CRS form logic',
          text: lines[0],
        },
        {
          id: 'pg202',
          teamId: 'solutions-engineering',
          team: 'Solutions Engineering',
          title: 'PG-202 DealCloud mapping for CRS fields',
          text: lines[1],
        },
        {
          id: 'pg203',
          teamId: 'engineering',
          team: 'Engineering',
          title: 'PG-203 Country list field type',
          text: lines[2],
        },
      ],
      x: fx + 12,
      y: 226 - 7,
      width: 24,
      height: 14,
      dir: 'down',
      tone: 'proceed',
      wait: false,
      ariaLabel: `3 handoffs from Analyse the CRS and FATCA rules: ${lines.join('; ')}`,
      tooltip: lines.join('\n'),
    });
  });

  it('puts the mark of an open source after the T line, in red, with the when-done wording', () => {
    const xt = L.x(Date.parse(AS_OF));
    const text =
      'Hands over to Digitization QA when done · received in Test the CRS section end to end';
    expect(L.handoffs.find((h) => h.fromId === 'pg203')).toMatchObject({
      targets: [{ id: 'test', text }],
      x: xt + 32,
      y: 474 - 7,
      width: 14,
      tone: 'danger',
      wait: true,
      ariaLabel: text,
      tooltip: text,
    });
  });

  it('gives a source one mark per source row, never one per receiver', () => {
    const sources = L.handoffs.map((h) => h.fromId);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it('marks a leads-from link inside one team too, with no curve', () => {
    const s = twoTeams(
      [
        { id: 'a', teamId: 't1' },
        { id: 'b', teamId: 't1', after: ['a'] },
      ],
      [
        { id: 'a1', workItemId: 'a', kind: 'done', at: at('2026-09-22T16:40') },
        { id: 'b1', workItemId: 'b', at: at('2026-09-23T09:20') },
      ],
    );
    const S = layoutTracker(s, view());
    expect(S.handoffs).toEqual([
      expect.objectContaining({
        fromId: 'a',
        dir: 'down',
        tooltip: 'Handed over to One · received in b',
      }),
    ]);
  });

  it('points the mark up, down, or both ways by where the receivers are', () => {
    const s = twoTeams(
      [
        { id: 'up', teamId: 't1', after: ['src'] },
        { id: 'src', teamId: 't2' },
        { id: 'down', teamId: 't2', after: ['src'] },
      ],
      [{ id: 's1', workItemId: 'src', kind: 'done', at: at('2026-09-20T09:00') }],
    );
    expect(layoutTracker(s, view()).handoffs[0].dir).toBe('both');
    expect(layoutTracker(s, view({ hiddenRows: new Set(['down']) })).handoffs[0].dir).toBe('both');
    s.workItems.find((w) => w.id === 'down')!.after = [];
    expect(layoutTracker(s, view()).handoffs[0]).toMatchObject({ dir: 'up', width: 14 });
  });

  it('keeps every receiver on the mark when one is hidden, so a click can show it again', () => {
    const H = layoutTracker(larkspurState(), view({ hiddenRows: new Set(['pg201']) }));
    const ids = (M: TrackerLayout) =>
      M.handoffs.find((h) => h.fromId === 'analyse')!.targets.map((t) => t.id);
    expect(ids(H)).toEqual(['pg201', 'pg202', 'pg203']);
    const T = layoutTracker(larkspurState(), view({ hiddenTeams: new Set(['engineering']) }));
    expect(ids(T)).toEqual(['pg201', 'pg202', 'pg203']);
  });

  it('puts the mark left of the finish when it would pass the right edge', () => {
    const s = twoTeams(
      [
        { id: 'src', teamId: 't1' },
        { id: 'x', teamId: 't2', after: ['src'] },
        { id: 'y', teamId: 't2', after: ['src'] },
      ],
      [{ id: 's1', workItemId: 'src', kind: 'done', at: at('2026-10-16T22:00') }],
    );
    const E = layoutTracker(s, view());
    const fx = E.x(ms('2026-10-16T22:00'));
    const [mark] = E.handoffs;
    expect(mark.x).toBe(fx - 12 - 24);
    expect(mark.x + mark.width).toBeLessThanOrEqual(E.width);
  });

  it('draws no mark for a receiving work item outside the window', () => {
    const s = twoTeams(
      [
        { id: 'src', teamId: 't1' },
        { id: 'gone', teamId: 't2', after: ['src'] },
      ],
      [
        { id: 's1', workItemId: 'src', at: at('2026-09-20T09:00') },
        { id: 'g1', workItemId: 'gone', kind: 'done', at: at('2026-09-01T09:00') },
      ],
    );
    const W = layoutTracker(s, view());
    expect(W.rows.map((r) => r.id)).toEqual(['src']);
    expect(W.handoffs).toEqual([]);
  });

  it('draws no mark from a hidden source, and its receivers get an arrow chip', () => {
    const H = layoutTracker(larkspurState(), view({ hiddenRows: new Set(['analyse']) }));
    expect(H.handoffs.some((h) => h.fromId === 'analyse')).toBe(false);
    for (const id of ['pg201', 'pg202', 'pg203'])
      expect(H.chips.find((c) => c.workItemId === id)).toMatchObject({
        sources: ['analyse'],
        tooltip: 'From Analyse the CRS and FATCA rules (hidden)',
      });
  });

  it('lists every hidden source of a row in one chip', () => {
    const H = layoutTracker(
      larkspurState(),
      view({ hiddenRows: new Set(['pg201', 'pg202', 'pg203', 'crs']) }),
    );
    expect(H.chips.find((c) => c.workItemId === 'test')).toMatchObject({
      sources: ['crs', 'pg201', 'pg202', 'pg203'],
      ariaLabel:
        'Show CRS tax residency section with DealCloud sync, PG-201 CRS form logic, PG-202 DealCloud mapping for CRS fields, PG-203 Country list field type',
    });
    expect(H.chips.find((c) => c.workItemId === 'test')?.tooltip.split('\n')).toHaveLength(4);
  });

  it('leaves out a hidden source that a shown source of the row comes from', () => {
    const H = layoutTracker(
      larkspurState(),
      view({ hiddenRows: new Set(['pg201', 'pg202', 'crs']) }),
    );
    expect(H.chips.find((c) => c.workItemId === 'test')?.sources).toEqual(['pg201', 'pg202']);
  });

  it('shows a chip for a source or parent that finished before the window', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      workItems: [
        workItem({ id: 'p', title: 'Analyse the CRS and FATCA rules', teamId: 't' }),
        workItem({ id: 'c', teamId: 't', parentId: 'p', after: ['p'] }),
      ],
      events: [
        event({ id: 'p1', workItemId: 'p', kind: 'done', at: at('2026-09-01T09:00') }),
        event({ id: 'c1', workItemId: 'c', at: at('2026-09-20T09:00') }),
      ],
    });
    const C = layoutTracker(s, view());
    expect(C.rows.map((r) => r.id)).toEqual(['c']);
    const y = C.rows[0].y;
    const sx = C.x(ms('2026-09-20T09:00'));
    expect(C.chips).toEqual([
      {
        workItemId: 'c',
        sources: ['p'],
        ariaLabel: 'Show Analyse the CRS and FATCA rules',
        tooltip: 'From Analyse the CRS and FATCA rules (finished before 10 Sept)',
        x: sx - 22,
        y: y - 7,
        size: 14,
      },
    ]);
    expect(C.handoffs).toEqual([]);
  });

  it('keeps an arrow chip right of the label column', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      workItems: [
        workItem({ id: 'p', teamId: 't' }),
        workItem({ id: 'c', teamId: 't', parentId: 'p' }),
      ],
      events: [
        event({ id: 'p1', workItemId: 'p', at: at('2026-09-20T09:00') }),
        event({ id: 'c1', workItemId: 'c', at: at('2026-09-10T06:00') }),
      ],
    });
    const C = layoutTracker(s, view({ hiddenRows: new Set(['p']) }));
    expect(C.chips[0].x).toBe(SIDE + 2);
  });
});

describe('layoutTracker: milestones and trunk', () => {
  const L = layoutTracker(larkspurState(), view());

  it('marks CRM integration live late', () => {
    const crm = L.milestones.find((m) => m.name === 'CRM integration live')!;
    expect(crm).toMatchObject({
      id: 'crm',
      x: L.x(dayEnd('2026-09-18')),
      y: TRUNK_Y,
      status: 'late',
      tone: 'danger',
      stroke: 'danger',
      labelTone: 'danger',
      filled: true,
      icon: 'bang',
      changed: false,
      label: 'CRM integration live · 18 Sept · Late',
      ariaLabel: 'CRM integration live · 18 Sept · Late',
      anchor: 'start',
      level: 0,
      labelY: MS_Y,
    });
    expect(crm.labelX).toBe(crm.x + 14);
  });

  it('draws the trunk and a red segment from each late milestone to the T line', () => {
    const xt = L.x(Date.parse(AS_OF));
    expect(L.trunk).toEqual({ x1: X0, x2: X1, y: TRUNK_Y });
    expect(L.trunkSegments).toEqual([
      { milestoneId: 'crm', x1: L.x(dayEnd('2026-09-18')), x2: xt, y: TRUNK_Y, tone: 'danger' },
      { milestoneId: 'golive', x1: L.x(dayEnd('2026-09-30')), x2: xt, y: TRUNK_Y, tone: 'danger' },
    ]);
  });

  it('draws amber from the date to the finish when a milestone finished late', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      milestones: [
        { id: 'm', name: 'M', planned: '2026-09-20', firstPlanned: '2026-09-20', moves: [] },
      ],
      workItems: [workItem({ id: 'w', teamId: 't', milestoneId: 'm' })],
      events: [event({ id: 'd', workItemId: 'w', kind: 'done', at: at('2026-09-25T10:00') })],
    });
    const M = layoutTracker(s, view());
    expect(M.trunkSegments).toEqual([
      {
        milestoneId: 'm',
        x1: M.x(dayEnd('2026-09-20')),
        x2: M.x(ms('2026-09-25T10:00')),
        y: TRUNK_Y,
        tone: 'caution',
      },
    ]);
  });

  it('draws teal from the finish to the date when a milestone finished early', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      milestones: [
        { id: 'm', name: 'M', planned: '2026-09-30', firstPlanned: '2026-09-30', moves: [] },
      ],
      workItems: [workItem({ id: 'w', teamId: 't', milestoneId: 'm' })],
      events: [event({ id: 'd', workItemId: 'w', kind: 'done', at: at('2026-09-25T10:00') })],
    });
    const M = layoutTracker(s, view());
    expect(M.milestones[0]).toMatchObject({
      status: 'early',
      tone: 'teal',
      filled: true,
      icon: 'tick',
    });
    expect(M.trunkSegments[0]).toMatchObject({
      x1: M.x(ms('2026-09-25T10:00')),
      x2: M.x(dayEnd('2026-09-30')),
      tone: 'teal',
    });
  });

  it('draws a planned milestone hollow and grey without a trunk segment', () => {
    const s = buildState({
      milestones: [
        { id: 'm', name: 'M', planned: '2026-10-14', firstPlanned: '2026-10-14', moves: [] },
      ],
    });
    const M = layoutTracker(s, view());
    expect(M.milestones[0]).toMatchObject({
      status: 'planned',
      tone: 'ink-3',
      filled: false,
      icon: null,
    });
    expect(M.trunkSegments).toEqual([]);
  });

  it('right-aligns a label near the right edge', () => {
    const s = buildState({
      milestones: [
        { id: 'm', name: 'Late', planned: '2026-10-15', firstPlanned: '2026-10-15', moves: [] },
      ],
    });
    const m = layoutTracker(s, view()).milestones[0];
    expect(m.anchor).toBe('end');
    expect(m.labelX).toBe(m.x - 14);
    expect(m.labelBox.x1).toBe(m.x - 14);
  });

  it('never overlaps two labels on the same level', () => {
    const s = larkspurState();
    s.milestones.push(
      { id: 'm1', name: 'Close one', planned: '2026-09-19', firstPlanned: '2026-09-19', moves: [] },
      { id: 'm2', name: 'Far one', planned: '2026-10-05', firstPlanned: '2026-10-05', moves: [] },
    );
    for (const L of [layoutTracker(larkspurState(), view()), layoutTracker(s, view({ zoom: 2 }))]) {
      const ms = L.milestones;
      for (const a of ms)
        for (const b of ms) {
          if (a === b || a.level !== b.level) continue;
          const apart = a.labelBox.x0 >= b.labelBox.x1 + 8 || a.labelBox.x1 <= b.labelBox.x0 - 8;
          expect(apart, `${a.id} and ${b.id}`).toBe(true);
        }
    }
    const levels = layoutTracker(s, view({ zoom: 2 })).milestones.map((m) => [
      m.id,
      m.level,
      m.labelY,
    ]);
    expect(levels).toEqual([
      ['crm', 0, MS_Y],
      ['m1', 1, TRUNK_Y + 13],
      ['golive', 0, MS_Y],
      ['m2', 1, TRUNK_Y + 13],
    ]);
  });
});

describe('layoutTracker: change marks', () => {
  it('marks changed rows, events, milestones and milestone dates', () => {
    const marks: Marks = {
      workItems: new Set(['pg203']),
      events: new Set(['p32']),
      milestones: new Set(['crm']),
      dates: new Set(['golive', 'ms:crm']),
    };
    const L = layoutTracker(larkspurState(), view(), marks);
    expect(L.rows.filter((r) => r.changed).map((r) => r.id)).toEqual(['pg203']);
    expect(L.eventGroups.filter((g) => g.changed).map((g) => g.eventIds)).toEqual([['p32']]);
    expect(L.deadlines.filter((d) => d.changed).map((d) => d.workItemId)).toEqual([
      'dynamics',
      'syncmon',
      'crmlive',
    ]);
    expect(L.deadlines.find((d) => d.workItemId === 'dynamics')?.stroke).toBe('change');
    const crm = L.milestones.find((m) => m.id === 'crm')!;
    expect(crm).toMatchObject({
      changed: true,
      stroke: 'change',
      labelTone: 'danger',
      tone: 'danger',
    });
    expect(L.milestones.find((m) => m.id === 'golive')?.changed).toBe(false);
  });

  it('shows the earlier date of a moved milestone in a change request only', () => {
    const move = (date: string, why: string) =>
      makeOp('msDate', { milestoneId: 'crm', date, why, by: 'minh', at: at('2026-10-08T16:55') });
    const replay = replayOps(larkspurState(), [
      move('2026-09-22', 'The sandbox is late.'),
      move('2026-09-25', 'The vendor needs more time.'),
    ]);
    const crm = (L: TrackerLayout) => L.milestones.find((m) => m.id === 'crm')!;
    const draft = crm(layoutTracker(replay.state, view(), replay.marks));
    expect(draft.label).toBe('CRM integration live · 25 Sept · Late (was 22 Sept)');
    expect(draft.ariaLabel).toBe(draft.label);
    expect(crm(layoutTracker(replay.state, view())).label).toBe(
      'CRM integration live · 25 Sept · Late',
    );
    const renamed = replayOps(larkspurState(), [
      makeOp('msName', { milestoneId: 'crm', name: 'CRM sync live' }),
    ]);
    expect(crm(layoutTracker(renamed.state, view(), renamed.marks)).label).toBe(
      'CRM sync live · 18 Sept · Late',
    );
    const renamedAfterMove = replayOps(replay.state, [
      makeOp('msName', { milestoneId: 'crm', name: 'CRM sync live' }),
    ]);
    expect(crm(layoutTracker(renamedAfterMove.state, view(), renamedAfterMove.marks)).label).toBe(
      'CRM sync live · 25 Sept · Late',
    );
    const itemMoved = replayOps(larkspurState(), [
      makeOp('due', {
        workItemId: 'golive',
        date: '2026-10-16',
        why: 'Later.',
        by: 'minh',
        at: at('2026-10-08T16:55'),
      }),
    ]);
    const golive = layoutTracker(itemMoved.state, view(), itemMoved.marks).milestones.find(
      (m) => m.id === 'golive',
    )!;
    expect(golive.label).not.toContain('(was');
  });

  it('reads the marks of a replay', () => {
    const replay = replayOps(larkspurState(), [
      makeOp('rename', { workItemId: 'pg203', title: 'PG-203 Country list field (multi-select)' }),
    ]);
    const L = layoutTracker(replay.state, view(), replay.marks);
    expect(L.rows.find((r) => r.id === 'pg203')).toMatchObject({
      changed: true,
      title: 'PG-203 Country list field (multi-select)',
    });
  });

  it('flags nothing without marks', () => {
    const L = layoutTracker(larkspurState(), view(), noMarks());
    expect(L.rows.some((r) => r.changed) || L.eventGroups.some((g) => g.changed)).toBe(false);
  });
});

describe('layoutTracker: purity', () => {
  it('leaves a frozen state unchanged and gives the same layout twice', () => {
    const state: TrackerState = deepFreeze(larkspurState());
    const a = layoutTracker(state, view({ hiddenRows: new Set(['pg203']), zoom: 2 }));
    const b = layoutTracker(state, view({ hiddenRows: new Set(['pg203']), zoom: 2 }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('layoutTracker: focus on a work item', () => {
  it('shows only the work item and its descendants, and drops lanes without rows', () => {
    const L = layoutTracker(larkspurState(), view({ focus: 'analyse' }));
    expect(L.rows.map((r) => r.id)).toEqual(['analyse', 'pg201', 'pg202', 'pg203', 'test']);
    expect(L.lanes.map((l) => l.teamId)).toEqual([
      'digitization',
      'solutions-engineering',
      'engineering',
      'digitization-qa',
    ]);
    expect(L.lanes[0].top).toBe(TRUNK_Y + 16);
    expect(L.rows[0]).toMatchObject({
      focused: true,
      focusLabel: 'Focus on Analyse the CRS and FATCA rules',
    });
    expect(L.rows[1]).toMatchObject({
      focused: false,
      focusLabel: 'Focus on PG-201 CRS form logic',
    });
  });

  it('drops an empty team while focused', () => {
    const s = buildState({
      teams: [
        { id: 't', name: 'Team', leadId: null },
        { id: 'empty', name: 'Empty', leadId: null },
      ],
      workItems: [workItem({ id: 'a', teamId: 't' })],
      events: [event({ id: 'a1', workItemId: 'a', at: at('2026-09-20T09:00') })],
    });
    const all = layoutTracker(s, view());
    expect(all.lanes.map((l) => l.teamId)).toEqual(['t', 'empty']);
    expect(layoutTracker(s, view({ focus: 'a' })).lanes.map((l) => l.teamId)).toEqual(['t']);
  });

  it('gives no chip for a parent or a source outside the focus', () => {
    const L = layoutTracker(larkspurState(), view({ focus: 'analyse' }));
    expect(L.chips).toEqual([]);
  });

  it('keeps hidden rows hidden inside the focus', () => {
    const L = layoutTracker(
      larkspurState(),
      view({ focus: 'analyse', hiddenRows: new Set(['pg202']) }),
    );
    expect(L.rows.map((r) => r.id)).toEqual(['analyse', 'pg201', 'pg203', 'test']);
    expect(L.chips.find((c) => c.workItemId === 'test')?.sources).toEqual(['pg202']);
  });

  it('ignores a focus on an unknown work item', () => {
    const L = layoutTracker(larkspurState(), view({ focus: 'nope' }));
    expect(L.rows).toHaveLength(13);
  });
});

describe('layoutTracker: filters', () => {
  const only = (match: string[], context: string[] = []) => ({
    match: new Set(match),
    context: new Set(context),
  });

  it('shows the matching rows and their ancestors dimmed, and drops teams without a row', () => {
    const L = layoutTracker(larkspurState(), view({ filter: only(['pg203'], ['crs']) }));
    expect(L.rows.map((r) => [r.id, r.dimmed])).toEqual([
      ['crs', true],
      ['pg203', false],
    ]);
    expect(L.lanes.map((l) => l.teamId)).toEqual(['implementation', 'engineering']);
    expect(L.lanes[0].top).toBe(TOP);
  });

  it('drops an empty team while filtering', () => {
    const s = buildState({
      teams: [
        { id: 't', name: 'Team', leadId: null },
        { id: 'empty', name: 'Empty', leadId: null },
      ],
      workItems: [workItem({ id: 'a', teamId: 't' })],
    });
    expect(layoutTracker(s, view({ filter: only(['a']) })).lanes.map((l) => l.teamId)).toEqual([
      't',
    ]);
  });

  it('gives no chip for a source the filters leave out', () => {
    const L = layoutTracker(larkspurState(), view({ filter: only(['test'], ['crs']) }));
    expect(L.rows.map((r) => r.id)).toEqual(['crs', 'test']);
    expect(L.chips).toEqual([]);
  });

  it('combines with hiding and with the focus', () => {
    const filter = only(['pg201', 'pg203'], ['crs']);
    const hidden = layoutTracker(
      larkspurState(),
      view({ filter, hiddenRows: new Set(['pg201', 'crs']) }),
    );
    expect(hidden.rows.map((r) => r.id)).toEqual(['pg203']);
    const focused = layoutTracker(larkspurState(), view({ filter, focus: 'analyse' }));
    expect(focused.rows.map((r) => r.id)).toEqual(['pg201', 'pg203']);
  });
});
