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

const { VW, X0, X1, SIDE, RAIL, TRUNK_Y, MS_Y, AXIS_Y, HEAD } = GEOMETRY;

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
const noon = (date: string) => Date.parse(`${date}T12:00:00+07:00`);

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

  it('maps the window between the label column and the milestone chip column', () => {
    expect(L.zoom).toBe(1);
    expect(L.rail).toBe(RAIL);
    expect(L.x1).toBe(X1 - RAIL);
    expect(L.width).toBe(VW - RAIL);
    expect(L.x(midnight('2026-09-10'))).toBeCloseTo(X0, 9);
    expect(L.x(midnight('2026-10-17'))).toBeCloseTo(X1 - RAIL, 9);
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

  it('gives the full width to the time line when no work item has a milestone', () => {
    const D = layoutTracker(buildState(), view());
    expect(D.rail).toBe(0);
    expect(D.x1).toBe(X1);
    expect(D.width).toBe(VW);
  });
});

describe('layoutTracker: time zoom', () => {
  const fit = layoutTracker(larkspurState(), view());
  const Z = layoutTracker(larkspurState(), view({ zoom: 3 }));

  it('widens the time line by the zoom factor and keeps the label column', () => {
    const plot = X1 - RAIL - X0;
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
    expect(Z.ticks.map((t) => t.date)).toEqual(fit.ticks.map((t) => t.date));
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
    const L = layoutTracker(larkspurState(), view({ offsets: { r1: 600 } }));
    expect(L.eventGroups.find((g) => g.workItemId === 'rehearsal')).toMatchObject({
      eventIds: ['r2', 'r3', 'r1'],
      topId: 'r1',
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
      hidden: false,
      count: 3,
      hiddenCount: 0,
      more: null,
      guide: { y1: TRUNK_Y + 36, y2: 166 },
      eyeLabel: 'Hide Implementation',
    });
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
    });
    expect(L.height).toBe(732);
  });

  it('keeps only the head line of a hidden team, with a button that shows its rows', () => {
    const L = layoutTracker(larkspurState(), view({ hiddenTeams: new Set(['engineering']) }));
    const lane = L.lanes.find((l) => l.teamId === 'engineering')!;
    const width = '4 hidden'.length * 5.4 + 12;
    expect(lane).toMatchObject({
      hidden: true,
      count: 4,
      hiddenCount: 4,
      guide: null,
      eyeLabel: 'Show Engineering',
      label: 'ENGINEERING',
      bottom: lane.top + HEAD + 2,
      more: {
        ids: ['dynamics', 'syncmon', 'crmlive', 'pg203'],
        text: '4 hidden',
        ariaLabel: 'Show 4 hidden work items in Engineering',
        x: X0 - 38 - width,
        width,
      },
    });
    const engineering = ['dynamics', 'syncmon', 'crmlive', 'pg203'];
    expect(L.rows.some((r) => engineering.includes(r.id))).toBe(false);
    expect(L.segments.some((s) => engineering.includes(s.workItemId))).toBe(false);
    expect(L.eventGroups.some((g) => engineering.includes(g.workItemId))).toBe(false);
    expect(L.goalTicks.some((d) => engineering.includes(d.workItemId))).toBe(false);
    expect(L.msChips.some((d) => engineering.includes(d.workItemId))).toBe(false);
    expect(L.laneDrops.map((d) => d.teamId)).not.toContain('engineering');
    expect(L.rows.find((r) => r.id === 'test')!.y).toBe(lane.bottom + HEAD + 16);
    expect(L).not.toHaveProperty('folds');
  });

  it('writes 1 hidden in the singular aria label', () => {
    const L = layoutTracker(larkspurState(), view({ hiddenTeams: new Set(['it']) }));
    expect(L.lanes.find((l) => l.teamId === 'it')?.more).toMatchObject({
      ids: ['secret'],
      text: '1 hidden',
      ariaLabel: 'Show 1 hidden work item in IT',
    });
  });

  it('drops a hidden row completely and counts it on its lane', () => {
    const L = layoutTracker(larkspurState(), view({ hiddenRows: new Set(['pg203']) }));
    expect(L.rows.some((r) => r.id === 'pg203')).toBe(false);
    expect(L.segments.some((s) => s.workItemId === 'pg203')).toBe(false);
    expect(L.lanes.find((l) => l.teamId === 'engineering')).toMatchObject({
      hidden: false,
      hiddenCount: 1,
      more: { ids: ['pg203'], text: '1 hidden' },
    });
    expect(L.rows.find((r) => r.id === 'test')!.y).toBe(534 - 32);
    expect(L.height).toBe(732 - 32);
  });

  it('shortens a long lane name to make room for the hidden button', () => {
    const L = layoutTracker(larkspurState(), view({ hiddenRows: new Set(['pg201', 'pg202']) }));
    const lane = L.lanes.find((l) => l.teamId === 'solutions-engineering')!;
    expect(lane.more?.text).toBe('2 hidden');
    expect(lane.label).toBe('SOLUTIONS ENGIN…');
    expect(L.lanes.find((l) => l.teamId === 'solutions-engineering' && l.name)?.name).toBe(
      'Solutions Engineering',
    );
  });

  it('offers a drop target on each visible lane', () => {
    const L = layoutTracker(larkspurState(), view());
    expect(L.laneDrops).toHaveLength(7);
    expect(L.laneDrops[0]).toEqual({
      teamId: 'implementation',
      x: X0,
      y: TRUNK_Y + 18,
      width: X1 - RAIL - X0,
      height: 18,
      text: 'Drop here: Implementation',
      textX: X0 + 10,
      textY: TRUNK_Y + 31,
    });
  });

  it('gives an empty lane room for drops', () => {
    const s = buildState({ teams: [{ id: 't', name: 'Team', leadId: null }] });
    const L = layoutTracker(s, view());
    expect(L.lanes[0]).toMatchObject({ top: 64, bottom: 64 + 22 + 18 + 6, count: 0, guide: null });
  });
});

describe('layoutTracker: segments, waits and stems', () => {
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
    expect(L.stems.some((s) => s.workItemId === 'dynamics')).toBe(false);
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
    expect(L.stems.find((x) => x.workItemId === 'placed')?.x).toBe(xt);
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

  it('drops a stem from the parent row, or from the trunk without a parent', () => {
    expect(L.stems.find((s) => s.workItemId === 'pg203')).toEqual({
      workItemId: 'pg203',
      parentId: 'crs',
      x: L.x(ms('2026-09-24T09:20')),
      y1: 134,
      y2: 474,
      tone: 'route',
    });
    expect(L.stems.find((s) => s.workItemId === 'rehearsal')).toMatchObject({
      parentId: null,
      y1: TRUNK_Y,
      y2: 166,
      tone: 'proceed',
    });
    expect(L.stems.find((s) => s.workItemId === 'test')).toMatchObject({ tone: 'ink-3' });
  });

  it('draws no stem for a row with a hidden parent, only a chip', () => {
    const H = layoutTracker(larkspurState(), view({ hiddenRows: new Set(['crs']) }));
    const y = H.rows.find((r) => r.id === 'analyse')!.y;
    const sx = H.x(ms('2026-09-15T13:00'));
    expect(H.stems.some((s) => s.workItemId === 'analyse' || s.workItemId === 'pg201')).toBe(false);
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

  it('draws no stem for a row with a parent in a hidden team', () => {
    const H = layoutTracker(larkspurState(), view({ hiddenTeams: new Set(['implementation']) }));
    expect(H.stems.some((s) => s.workItemId === 'pg203')).toBe(false);
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

  it('ticks the milestone date on member rows while the date has not passed', () => {
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
      ],
      workItems: [
        workItem({ id: 'open', teamId: 't', milestoneId: 'm', plannedFinish: '2026-10-11' }),
        workItem({ id: 'done', teamId: 't', milestoneId: 'm', plannedFinish: '2026-10-11' }),
        workItem({ id: 'slips', teamId: 't', milestoneId: 'm', plannedFinish: '2026-10-14' }),
        workItem({ id: 'none', teamId: 't' }),
      ],
      events: [
        event({ id: 'o1', workItemId: 'open', at: at('2026-10-01T09:00') }),
        event({ id: 'd1', workItemId: 'done', kind: 'done', at: at('2026-10-02T09:00') }),
        event({ id: 's1', workItemId: 'slips', at: at('2026-10-01T09:00') }),
      ],
    });
    const M = layoutTracker(s, view());
    const y = (id: string) => M.rows.find((r) => r.id === id)!.y;
    expect(M.goalTicks.map((g) => [g.workItemId, g.tone])).toEqual([
      ['open', 'ink-2'],
      ['done', 'ink-2'],
      ['slips', 'danger'],
    ]);
    expect(M.goalTicks[0]).toEqual({
      workItemId: 'open',
      milestoneId: 'm',
      date: '2026-10-12',
      dateLabel: '12 Oct',
      dateAnchor: 'start',
      x: M.x(noon('2026-10-12')),
      y: y('open'),
      tone: 'ink-2',
      changed: false,
      ariaLabel: 'Milestone Portal live due 12 Oct',
      tooltip: 'Milestone Portal live due 12 Oct',
    });
    expect(M.goalTicks[2].tooltip).toBe(
      'Milestone Portal live due 12 Oct\nThis work item makes it late.',
    );
    expect(M.goalTicks[0].x).toBe(M.milestones[0].x);
  });

  it('ticks a passed milestone date only on the rows that make it late', () => {
    const tick = (id: string) => L.goalTicks.find((g) => g.workItemId === id);
    expect(L.goalTicks.map((g) => [g.workItemId, g.milestoneId, g.tone])).toEqual([
      ['golive', 'golive', 'danger'],
      ['crs', 'golive', 'danger'],
      ['dynamics', 'crm', 'danger'],
      ['incident', 'golive', 'danger'],
      ['secret', 'golive', 'danger'],
    ]);
    expect(tick('rehearsal')).toBeUndefined();
    expect(tick('crmlive')).toBeUndefined();
    expect(tick('dynamics')).toMatchObject({
      x: L.x(noon('2026-09-18')),
      dateLabel: '18 Sept',
      ariaLabel: 'Milestone CRM integration live due 18 Sept',
    });
  });

  it('colours the tick amber on a row that finished after the milestone date', () => {
    const s = larkspurState();
    s.events.push(
      event({ id: 'late', workItemId: 'incident', kind: 'done', at: at('2026-10-05T10:00') }),
    );
    const tick = layoutTracker(s, view()).goalTicks.find((g) => g.workItemId === 'incident');
    expect(tick).toMatchObject({ tone: 'caution' });
    expect(tick?.tooltip).toBe(
      'Milestone Go-live and first close due 30 Sept\nThis work item finished after it.',
    );
  });

  it('keeps the tick on the milestone day itself', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      milestones: [
        { id: 'm', name: 'M', planned: '2026-10-09', firstPlanned: '2026-10-09', moves: [] },
      ],
      workItems: [
        workItem({ id: 'w', teamId: 't', milestoneId: 'm', plannedFinish: '2026-10-08' }),
      ],
    });
    expect(layoutTracker(s, view()).goalTicks.map((g) => g.tone)).toEqual(['ink-2']);
  });

  it('puts the date left of its tick when the text would pass the right edge', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      milestones: [
        { id: 'm', name: 'M', planned: '2026-10-16', firstPlanned: '2026-10-16', moves: [] },
        { id: 'n', name: 'N', planned: '2026-10-12', firstPlanned: '2026-10-12', moves: [] },
      ],
      workItems: [
        workItem({ id: 'a', teamId: 't', milestoneId: 'm' }),
        workItem({ id: 'b', teamId: 't', milestoneId: 'n' }),
      ],
    });
    const M = layoutTracker(s, view());
    expect(M.goalTicks.map((g) => [g.dateLabel, g.dateAnchor])).toEqual([
      ['16 Oct', 'end'],
      ['12 Oct', 'start'],
    ]);
  });

  it('keeps a tick inside the right edge', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      milestones: [
        { id: 'm', name: 'M', planned: '2026-12-01', firstPlanned: '2026-12-01', moves: [] },
      ],
      workItems: [workItem({ id: 'a', teamId: 't', milestoneId: 'm' })],
    });
    const M = layoutTracker(s, view());
    expect(M.goalTicks[0].x).toBe(M.x1 - 4);
  });
});

describe('layoutTracker: milestone chips', () => {
  const L = layoutTracker(larkspurState(), view());
  const chip = (id: string) => L.msChips.find((c) => c.workItemId === id);

  it('puts a chip with the milestone name on each member row', () => {
    expect(L).not.toHaveProperty('msLinks');
    expect(L.msChips.map((c) => c.workItemId)).toEqual([
      'golive',
      'crs',
      'rehearsal',
      'dynamics',
      'syncmon',
      'crmlive',
      'incident',
      'secret',
    ]);
    const text = '◆ Go-live and first…';
    const width = text.length * 5.6 + 14;
    expect(chip('rehearsal')).toEqual({
      workItemId: 'rehearsal',
      milestoneId: 'golive',
      text,
      tone: 'ink-2',
      x: RAIL - width - 6,
      y: 166 - 7,
      width,
      height: 14,
      ariaLabel: 'Milestone Go-live and first close, due 30 Sept',
      tooltip: 'Go-live and first close · 30 Sept',
    });
  });

  it('colours a chip red when its open row makes the milestone late, by date or by today', () => {
    expect(chip('golive')?.tone).toBe('danger');
    expect(chip('incident')?.tone).toBe('danger');
    expect(chip('secret')?.tone).toBe('danger');
    expect(chip('dynamics')?.tone).toBe('danger');
    expect(chip('crmlive')?.tone).toBe('ink-2');
    expect(chip('secret')).toMatchObject({
      ariaLabel: 'Milestone Go-live and first close, due 30 Sept, this work item makes it late',
      tooltip: 'Go-live and first close · 30 Sept\nThis work item makes it late.',
    });
  });

  it('colours a chip amber when its row finished after the milestone date', () => {
    const s = larkspurState();
    s.events.push(
      event({ id: 'late', workItemId: 'incident', kind: 'done', at: at('2026-10-05T10:00') }),
    );
    const late = layoutTracker(s, view()).msChips.find((c) => c.workItemId === 'incident');
    expect(late?.tone).toBe('caution');
  });

  it('keeps an open row before a future milestone neutral', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      milestones: [
        { id: 'm', name: 'M', planned: '2026-10-14', firstPlanned: '2026-10-14', moves: [] },
      ],
      workItems: [
        workItem({ id: 'fine', teamId: 't', milestoneId: 'm', plannedFinish: '2026-10-13' }),
        workItem({ id: 'slips', teamId: 't', milestoneId: 'm', plannedFinish: '2026-10-15' }),
      ],
    });
    expect(layoutTracker(s, view()).msChips.map((c) => [c.text, c.tone])).toEqual([
      ['◆ M', 'ink-2'],
      ['◆ M', 'danger'],
    ]);
  });
});

describe('layoutTracker: links', () => {
  const L = layoutTracker(larkspurState(), view());

  it('curves a leads-from link from the finish of the source to the start of the target', () => {
    const link = L.links.find((l) => l.fromId === 'analyse' && l.toId === 'pg201')!;
    const x1 = L.x(ms('2026-09-22T16:40'));
    const x2 = L.x(ms('2026-09-23T09:20'));
    const dx = Math.max(24, Math.abs(x2 - x1) / 2);
    expect(link).toEqual({
      fromId: 'analyse',
      toId: 'pg201',
      tone: 'proceed',
      wait: false,
      from: { x: x1, y: 226 },
      c1: { x: x1 + dx, y: 226 },
      c2: { x: x2 - dx, y: 286 },
      to: { x: x2, y: 286 },
    });
  });

  it('draws a red waiting link at the T line from an open source', () => {
    const link = L.links.find((l) => l.fromId === 'pg203' && l.toId === 'test')!;
    const xt = L.x(Date.parse(AS_OF));
    expect(link).toMatchObject({ wait: true, tone: 'danger' });
    expect(link).not.toHaveProperty('ghost');
    expect([link.from, link.to]).toEqual([
      { x: xt, y: 474 },
      { x: xt, y: 534 },
    ]);
  });

  it('draws no link from a hidden source and shows an arrow chip instead', () => {
    const H = layoutTracker(larkspurState(), view({ hiddenRows: new Set(['analyse']) }));
    expect(H.links.some((l) => l.fromId === 'analyse')).toBe(false);
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

  it('draws no link into a hidden row', () => {
    const H = layoutTracker(larkspurState(), view({ hiddenRows: new Set(['test']) }));
    expect(H.links.some((l) => l.toId === 'test')).toBe(false);
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
    expect(C.stems).toEqual([]);
    expect(C.links).toEqual([]);
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
      x: L.x(noon('2026-09-18')),
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
    expect(L.trunk).toEqual({ x1: X0, x2: X1 - RAIL, y: TRUNK_Y });
    expect(L.trunkSegments).toEqual([
      { milestoneId: 'crm', x1: L.x(noon('2026-09-18')), x2: xt, y: TRUNK_Y, tone: 'danger' },
      { milestoneId: 'golive', x1: L.x(noon('2026-09-30')), x2: xt, y: TRUNK_Y, tone: 'danger' },
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
        x1: M.x(noon('2026-09-20')),
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
      x2: M.x(noon('2026-09-30')),
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
      ['m1', 1, TRUNK_Y + 17],
      ['golive', 0, MS_Y],
      ['m2', 1, TRUNK_Y + 17],
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
    expect(L.goalTicks.filter((d) => d.changed).map((d) => d.workItemId)).toEqual(['dynamics']);
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
