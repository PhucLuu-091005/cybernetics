import { describe, expect, it } from 'vitest';
import {
  GEOMETRY,
  ROW_LEVELS,
  layoutTracker,
  cutToWidth,
  laneNameWidth,
  type Density,
  windowStartFor,
  type LayoutSegment,
  type TrackerLayout,
  type View,
  WAIT_CHAR,
} from '../../../src/tracker/layout';
import type { TrackerState } from '../../../src/tracker/model';
import { replayOps, type Marks } from '../../../src/tracker/ops';
import { larkspurCrs } from '../../../src/server/tracker/seed/larkspur';
import { addDays, compareDay } from '../../../src/tracker/time';
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

  it('puts no tick on a first day that is a Monday, where the label column would cut it', () => {
    const M = layoutTracker(larkspurState(), view({ windowStart: '2026-06-29' }));
    expect(M.ticks[0].date).toBe('2026-07-06');
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
    expect(D.window.start).toBe('2026-09-11');
    expect(D.window.end).toBe('2026-10-19');
  });

  it('covers items finished long ago in the default range, so none goes missing', () => {
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
    expect(D.window.start).toBe('2026-06-17');
    expect(D.window.end).toBe('2026-10-16');
    expect(D.rows.map((r) => r.id)).toEqual(['old', 'recent', 'open']);
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

describe('layoutTracker: axis ticks never crowd', () => {
  const LABEL_ROOM = 64;
  const at = (dayWidth: number, windowStart = '2026-01-05') =>
    layoutTracker(larkspurState(), view({ windowStart, dayWidth, span: 4000 }));
  const gaps = (L: TrackerLayout) => L.ticks.slice(1).map((tick, i) => tick.x - L.ticks[i].x);

  it('keeps every two neighbouring ticks at least one label apart, at any zoom', () => {
    for (const dayWidth of [2, 2.5, 3, 4.5, 6, 8, 9, 9.2, 12, 20, 40, 63, 64, 120, 480]) {
      const L = at(dayWidth);
      expect(L.ticks.length).toBeGreaterThan(1);
      expect(Math.min(...gaps(L))).toBeGreaterThanOrEqual(LABEL_ROOM - 0.5);
    }
  });

  it('picks the shortest step that fits: a day, a week, two weeks, a month or three months', () => {
    expect(
      at(64)
        .ticks.slice(0, 2)
        .map((t) => t.date),
    ).toEqual(['2026-01-06', '2026-01-07']);
    expect(
      at(10)
        .ticks.slice(0, 2)
        .map((t) => t.date),
    ).toEqual(['2026-01-12', '2026-01-19']);
    expect(
      at(5)
        .ticks.slice(0, 2)
        .map((t) => t.date),
    ).toEqual(['2026-01-12', '2026-01-26']);
    expect(
      at(3)
        .ticks.slice(0, 3)
        .map((t) => t.date),
    ).toEqual(['2026-02-01', '2026-03-01', '2026-04-01']);
    expect(
      at(2)
        .ticks.slice(0, 2)
        .map((t) => t.date),
    ).toEqual(['2026-04-01', '2026-07-01']);
    expect(at(3).ticks[0].label).toBe('1 Feb');
  });
});

describe('layoutTracker: a scale that does not follow the width', () => {
  const DAYS = 37;
  const plot = X1 - X0;
  const fitDay = plot / DAYS;
  const span = VW - SIDE;

  it('fits the window to the visible time line by default and reports that day width', () => {
    const L = layoutTracker(larkspurState(), view());
    expect(L.fitDayWidth).toBeCloseTo(fitDay, 9);
    expect(L.dayWidth).toBeCloseTo(fitDay, 9);
    expect(L.zoom).toBe(1);
    const wider = layoutTracker(larkspurState(), view({ span: span + 300 }));
    expect(wider.fitDayWidth).toBeCloseTo((plot + 300) / DAYS, 9);
  });

  it('keeps one day width when the visible time line widens, and draws more time instead', () => {
    const narrow = layoutTracker(larkspurState(), view({ dayWidth: 40, span }));
    const wide = layoutTracker(larkspurState(), view({ dayWidth: 40, span: span + 400 }));
    expect(narrow.dayWidth).toBe(40);
    expect(wide.dayWidth).toBe(40);
    expect(wide.x(midnight('2026-09-11')) - wide.x(midnight('2026-09-10'))).toBeCloseTo(40, 9);
    expect(wide.eventGroups).toEqual(narrow.eventGroups);
    expect(wide.deadlines.map((d) => d.x)).toEqual(narrow.deadlines.map((d) => d.x));
    expect(wide.milestones.map((m) => m.x)).toEqual(narrow.milestones.map((m) => m.x));
    expect(wide.x1).toBe(narrow.x1);
    expect(narrow.x1).toBeCloseTo(X0 + 40 * DAYS, 9);
  });

  it('fills a visible time line that is wider than the window, with ticks, trunk and drop bands', () => {
    const L = layoutTracker(larkspurState(), view({ dayWidth: 10, span: 900 }));
    expect(L.x1).toBe(SIDE + 900 - (VW - X1));
    expect(L.width).toBe(SIDE + 900);
    expect(L.window.end).toBe('2026-10-17');
    expect(L.ticks.at(-1)!.x).toBeLessThan(L.x1);
    expect(L.ticks.at(-1)!.date > '2026-10-17').toBe(true);
    expect(L.trunk.x2).toBe(L.x1);
    expect(L.laneDrops[0].width).toBe(L.x1 - X0);
    expect(L.zoom).toBeCloseTo(10 / ((900 - (X0 - SIDE) - (VW - X1)) / DAYS), 9);
  });

  it('keeps the first fit when the time line widens before any zoom', () => {
    const first = layoutTracker(larkspurState(), view({ fitSpan: span, span }));
    const wider = layoutTracker(larkspurState(), view({ fitSpan: span, span: span + 400 }));
    expect(wider.dayWidth).toBeCloseTo(first.dayWidth, 9);
    expect(wider.eventGroups).toEqual(first.eventGroups);
    expect(wider.zoom).toBeLessThan(1);
  });

  it('fits a window so long that the fit is under the floor, and keeps that fit', () => {
    const long = view({ windowStart: '2024-01-01' });
    const L = layoutTracker(larkspurState(), long);
    expect(L.fitDayWidth).toBeLessThan(GEOMETRY.MIN_DAY_WIDTH);
    const F = layoutTracker(larkspurState(), { ...long, dayWidth: L.fitDayWidth });
    expect(F.dayWidth).toBeCloseTo(L.fitDayWidth, 9);
    expect(F.zoom).toBeCloseTo(1, 9);
    expect(F.x1).toBeCloseTo(X1, 6);
  });

  it('keeps a given day width inside its limits', () => {
    const { MIN_DAY_WIDTH, MAX_DAY_WIDTH } = GEOMETRY;
    expect(layoutTracker(larkspurState(), view({ dayWidth: 0.01 })).dayWidth).toBe(MIN_DAY_WIDTH);
    expect(layoutTracker(larkspurState(), view({ dayWidth: 1e6 })).dayWidth).toBe(MAX_DAY_WIDTH);
    expect(layoutTracker(larkspurState(), view({ dayWidth: Number.NaN })).dayWidth).toBeCloseTo(
      fitDay,
      9,
    );
  });
});

describe('layoutTracker: events at their own time', () => {
  it('draws an event at its time, and the view takes no saved position', () => {
    const L = layoutTracker(larkspurState(), view());
    expect(L.eventGroups.find((g) => g.topId === 'p31')?.x).toBeCloseTo(
      L.x(ms('2026-09-24T09:20')),
      9,
    );
    expect(view()).not.toHaveProperty('offsets');
  });

  it('keeps the real time in the tooltip and the label', () => {
    const L = layoutTracker(larkspurState(), view());
    expect(L.eventGroups.find((g) => g.topId === 'p31')).toMatchObject({
      ariaLabel: 'Task by Lan Phạm, 24 Sept 09:20',
      tooltip:
        'Task · Lan Phạm · 24 Sept 09:20\nAdd a multi-select country list field. Target: 6 October.',
    });
  });

  it('stacks events that sit close, earlier ones under the later top event', () => {
    const groups = (L: TrackerLayout) =>
      L.eventGroups.filter((g) => g.workItemId === 'rehearsal').map((g) => g.eventIds);
    expect(groups(layoutTracker(larkspurState(), view({ zoom: 3 })))).toEqual([['r1', 'r2', 'r3']]);
    const Z = layoutTracker(larkspurState(), view({ zoom: 12 }));
    expect(groups(Z)).toEqual([['r1'], ['r2'], ['r3']]);
    expect(Z.eventGroups.find((g) => g.topId === 'r3')?.x).toBeCloseTo(
      Z.x(ms('2026-09-24T16:40')),
      9,
    );
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
      head: 28,
      bottom: 194,
      guide: { y1: TRUNK_Y + 40, y2: 172 },
      eyeLabel: 'Hide Implementation',
    });
    expect(L.lanes[0]).not.toHaveProperty('more');
    expect(L.lanes[0]).not.toHaveProperty('hidden');
    expect(L.lanes[0]).not.toHaveProperty('count');
    expect(L.lanes[0]).not.toHaveProperty('hiddenCount');
  });

  it('gives one row per visible work item', () => {
    const L = layoutTracker(larkspurState(), view());
    expect(L.rows.map((r) => [r.id, r.y])).toEqual([
      ['golive', 108],
      ['crs', 140],
      ['rehearsal', 172],
      ['analyse', 238],
      ['legal', 270],
      ['pg201', 336],
      ['pg202', 368],
      ['dynamics', 434],
      ['syncmon', 466],
      ['crmlive', 498],
      ['pg203', 530],
      ['test', 596],
      ['incident', 662],
      ['secret', 728],
      ['sso', 760],
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
    expect(L.height).toBe(838);
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
    expect(L.rows.find((r) => r.id === 'test')!.y).toBe(596 - height);
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
    expect(L.rows.find((r) => r.id === 'test')!.y).toBe(596 - 32);
    expect(L.height).toBe(838 - 32);
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
      height: 24,
      text: 'Drop here: Implementation',
      textX: X0 + 10,
      textY: TRUNK_Y + 34,
    });
  });

  it('gives an empty lane room for drops', () => {
    const s = buildState({ teams: [{ id: 't', name: 'Team', leadId: null }] });
    const L = layoutTracker(s, view());
    expect(L.lanes[0]).toMatchObject({ top: 64, bottom: 64 + 28 + 18 + 6, guide: null });
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

describe('the text of an empty row and the T line', () => {
  it('never lets the T line cross the text, at any zoom and with or without + buttons', () => {
    // PG-204 placed today waits for nothing and starts 48 hours before T, like seed #2 does.
    const placed = replayOps(larkspurState(), larkspurCrs()[1].ops).state;
    const crossings: string[] = [];
    for (const dayWidth of [2, 4, 8, 16, 26, 40, 80, 160, 480])
      for (const plusButtons of [false, true]) {
        const L = layoutTracker(placed, view({ dayWidth, plusButtons }));
        for (const s of L.segments) {
          if (s.kind !== 'wait') continue;
          const end = s.textX + s.text.length * WAIT_CHAR;
          if (s.textX < L.tLine.x + 3 && end > L.tLine.x - 3)
            crossings.push(`${s.workItemId} at ${dayWidth}${plusButtons ? ' +' : ''}`);
        }
      }
    expect(crossings).toEqual([]);
  });
});

describe('layoutTracker: segments and waits', () => {
  const L = layoutTracker(larkspurState(), view());

  it('turns PG-203 danger at the end of 6 Oct (planned 6 Oct, still open)', () => {
    const segs = lines(L, 'pg203');
    expect(segs.map((s) => s.tone)).toEqual(['route', 'danger']);
    expect(segs[0].x1).toBeCloseTo(L.x(ms('2026-09-24T09:20')), 9);
    expect(segs[0].x2).toBeCloseTo(L.x(dayEnd('2026-10-06')), 9);
    expect(segs[1].x1).toBeCloseTo(L.x(dayEnd('2026-10-06')), 9);
    expect(segs[1].x2).toBeCloseTo(L.x(Date.parse(AS_OF)), 9);
    expect(segs[1].y).toBe(530);
  });

  it('shows PG-202 caution after its planned day (finished late)', () => {
    const segs = lines(L, 'pg202');
    expect(segs.map((s) => s.tone)).toEqual(['proceed', 'caution']);
    expect(segs[1].x1).toBeCloseTo(L.x(ms('2026-10-01T17:00')), 9);
    expect(segs[1].x2).toBeCloseTo(L.x(ms('2026-10-03T10:00')), 9);
  });

  it('draws one blue or green line for items inside their plan', () => {
    expect(lines(L, 'crs').map((s) => s.tone)).toEqual(['route']);
    expect(lines(L, 'pg201').map((s) => s.tone)).toEqual(['proceed']);
  });

  it('widens a later window to the first event, so a line never starts cut at the label column', () => {
    const late = layoutTracker(larkspurState(), view({ windowStart: '2026-09-20' }));
    expect(compareDay(late.window.start, '2026-09-14')).toBeLessThan(0);
    const [seg] = lines(late, 'dynamics');
    expect(seg.x1).toBeGreaterThan(X0);
  });

  it('draws no connector line: no stems from the trunk or a parent, no leads-from curves', () => {
    expect(L).not.toHaveProperty('stems');
    expect(L).not.toHaveProperty('links');
  });

  it('draws a waiting line with the open items it waits for', () => {
    const wait = L.segments.find((s) => s.workItemId === 'test');
    const sx = L.x(ms('2026-10-03T10:00'));
    expect(wait).toEqual({
      kind: 'wait',
      workItemId: 'test',
      x1: sx,
      x2: L.x(Date.parse(AS_OF)),
      y: 596,
      tone: 'ink-3',
      text: 'Waiting for PG-203',
      textX: sx + 8,
      textY: 596 - 7,
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
    const sx = H.x(ms('2026-09-16T14:00'));
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
      y: 172,
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
    expect(L.eventGroups.filter((g) => g.workItemId === 'crs').map((g) => g.eventIds)).toEqual([
      ['c1'],
      ['c2', 'c3'],
    ]);
  });

  it('draws every event, also one before a given window start', () => {
    const late = layoutTracker(state, view({ windowStart: '2026-09-20' }));
    expect(
      late.eventGroups.filter((g) => g.workItemId === 'golive').flatMap((g) => g.eventIds),
    ).toEqual(['g1', 'g2', 'g3', 'g4']);
    expect(late.eventGroups.some((g) => g.workItemId === 'dynamics')).toBe(true);
  });

  it('colours an event after the planned finish red while open', () => {
    const pg203 = L.eventGroups.filter((g) => g.workItemId === 'pg203');
    expect(pg203.map((g) => [g.topId, g.tone])).toEqual([
      ['p31', 'route'],
      ['p32', 'danger'],
    ]);
    const pg202 = L.eventGroups.filter((g) => g.workItemId === 'pg202');
    expect(pg202.map((g) => g.tone)).toEqual(['proceed', 'proceed', 'caution']);
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
      ['legal', 'crm'],
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
      y: 172,
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
      expect(d.labelY - 9).toBeGreaterThanOrEqual(d.y - M.level.row / 2);
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
    expect(M.deadlines[0].x).toBeLessThanOrEqual(M.x1 - 4);
    expect(compareDay(M.window.end, '2026-12-01')).toBeGreaterThan(0);
  });
});

describe('layoutTracker: a milestone diamond never sits under an event icon', () => {
  it('moves the diamond beside the icon, on the side its time lies', () => {
    for (const density of ['comfortable', 'compact', 'dense'] as const) {
      const L = layoutTracker(larkspurState(), view({ density }));
      const { r, diamond } = L.level;
      for (const d of L.deadlines)
        for (const g of L.eventGroups.filter((x) => x.workItemId === d.workItemId))
          expect(Math.abs(d.x - g.x), `${density} ${d.workItemId}`).toBeGreaterThanOrEqual(
            r + diamond,
          );
      const legal = L.deadlines.find((d) => d.workItemId === 'legal')!;
      const done = L.eventGroups.find((g) => g.eventIds.includes('l3'))!;
      expect(legal.x).toBeGreaterThan(done.x);
    }
  });
});

describe('layoutTracker: milestone names keep off the T line', () => {
  const main = () => replayOps(larkspurState(), larkspurCrs()[0].ops, TIME_ZONE).state;
  const views = [300, 500, 800, 1000, 1200].flatMap((span) =>
    [1, 1.5, 2, 3].map((zoom) =>
      view({ windowStart: undefined, windowEnd: undefined, span, zoom }),
    ),
  );

  it('moves a row name to the other side of its mark or ends it with an ellipsis', () => {
    const cut: string[] = [];
    for (const v of views) {
      const L = layoutTracker(main(), v);
      for (const d of L.deadlines.filter((x) => x.label)) {
        const width = d.label!.length * 5.4 * (L.level.nameFont / 9.5);
        const [x0, x1] =
          d.labelAnchor === 'start' ? [d.labelX, d.labelX + width] : [d.labelX - width, d.labelX];
        expect(x1 < L.tLine.x - 2 || x0 > L.tLine.x + 2).toBe(true);
        if (d.label!.endsWith('…')) cut.push(d.label!);
      }
    }
    expect(cut.length).toBeGreaterThan(0);
    const names = main().milestones.map((m) => m.name);
    for (const label of cut) {
      expect(label.length).toBeGreaterThanOrEqual(8);
      expect(names.some((name) => name.startsWith(label.slice(0, -1)))).toBe(true);
    }
  });
});

describe('layoutTracker: the narrow label column of a phone', () => {
  const { NARROW_SIDE } = GEOMETRY;

  it('keeps the wide column without a width and reports the narrow one with it', () => {
    expect(layoutTracker(larkspurState(), view()).side).toBe(SIDE);
    expect(layoutTracker(larkspurState(), view({ side: NARROW_SIDE })).side).toBe(NARROW_SIDE);
    expect(NARROW_SIDE).toBeLessThanOrEqual(140);
  });

  it('cuts the row and team names to the narrow column, with an ellipsis', () => {
    for (const density of ['comfortable', 'compact', 'dense'] as Density[]) {
      const L = layoutTracker(larkspurState(), view({ side: NARROW_SIDE, density }));
      const char = (6.6 * L.level.font) / ROW_LEVELS.comfortable.font;
      for (const r of L.rows) {
        expect(28 + r.depth * INDENT + r.label.length * char).toBeLessThanOrEqual(NARROW_SIDE - 4);
        if (r.label !== r.title) expect(r.label.endsWith('…')).toBe(true);
      }
      expect(L.rows.some((r) => r.label !== r.title)).toBe(true);
      for (const lane of L.lanes) {
        const count = laneNameWidth(` · ${lane.summary.count}`, true);
        expect(24 + laneNameWidth(lane.label) + count).toBeLessThanOrEqual(NARROW_SIDE - 4);
      }
    }
  });

  it('leaves the time line where it was', () => {
    const wide = layoutTracker(larkspurState(), view({ span: 262 }));
    const narrow = layoutTracker(larkspurState(), view({ span: 262, side: NARROW_SIDE }));
    expect(narrow.tLine.x).toBe(wide.tLine.x);
    expect(narrow.width).toBe(wide.width);
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
    expect(L.deadlines[0]).toMatchObject({ date: '2026-10-08', time: '17:00' });
    // The diamond keeps its time order but moves off the Done icon an hour later.
    const { r, diamond } = L.level;
    const dx = L.deadlines[0].x;
    expect(Math.abs(dx - x)).toBeLessThan(r + diamond);
    expect(Math.abs(dx - xs(L).e3)).toBeGreaterThanOrEqual(r + diamond);
    expect(dx).toBeGreaterThan(xs(L).e2);
    expect(dx).toBeLessThan(xs(L).e3);
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

  it('puts one mark on the Handoff event of a source for all the work items it leads to', () => {
    const handoff = L.eventGroups.find((g) => g.eventIds.includes('a3'))!;
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
      eventId: 'a3',
      groupId: handoff.topId,
      x: handoff.x - 10,
      y: 238 - 10,
      width: 20,
      height: 20,
      dir: 'down',
      tone: 'proceed',
      wait: false,
      cancelled: false,
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
      eventId: null,
      x: xt + 32,
      y: 530 - 7,
      width: 14,
      tone: 'danger',
      wait: true,
      ariaLabel: text,
      tooltip: text,
    });
  });

  it('puts the mark at the finish when the source has no Handoff event, and none next to Done otherwise', () => {
    const s = twoTeams(
      [
        { id: 'src', teamId: 't1' },
        { id: 'x', teamId: 't2', after: ['src'] },
      ],
      [{ id: 's1', workItemId: 'src', kind: 'done', at: at('2026-09-22T16:40') }],
    );
    const P = layoutTracker(s, view());
    expect(P.handoffs[0]).toMatchObject({
      eventId: null,
      x: P.x(ms('2026-09-22T16:40')) + 12,
      y: P.rows[0].y - 7,
    });
    s.events.push(
      event({ id: 'h1', workItemId: 'src', kind: 'handoff', at: at('2026-09-20T10:00') }),
    );
    const M = layoutTracker(s, view({ zoom: 4 }));
    const marks = M.handoffs.filter((h) => h.fromId === 'src');
    expect(marks).toHaveLength(1);
    const h1 = M.eventGroups.find((g) => g.eventIds.includes('h1'))!;
    expect(marks[0]).toMatchObject({
      eventId: 'h1',
      groupId: 'h1',
      x: h1.x - 10,
      y: M.rows[0].y - 10,
      width: 20,
    });
  });

  it('takes the latest visible Handoff event, and counts an open source as handed over', () => {
    const s = twoTeams(
      [
        { id: 'src', teamId: 't1' },
        { id: 'x', teamId: 't2', after: ['src'] },
      ],
      [
        { id: 'h1', workItemId: 'src', kind: 'handoff', at: at('2026-09-20T10:00') },
        { id: 'h2', workItemId: 'src', kind: 'handoff', at: at('2026-09-24T10:00') },
        { id: 'h3', workItemId: 'src', kind: 'handoff', at: at('2026-09-26T10:00'), hidden: true },
      ],
    );
    const M = layoutTracker(s, view({ zoom: 4 }));
    const h2 = M.eventGroups.find((g) => g.eventIds.includes('h2'))!;
    expect(M.handoffs[0]).toMatchObject({
      eventId: 'h2',
      x: h2.x - 10,
      tone: 'proceed',
      wait: false,
      tooltip: 'Handed over to Two · received in x',
    });
  });

  it('uses a Handoff event before the given window start, as the range widens to it', () => {
    const s = twoTeams(
      [
        { id: 'src', teamId: 't1' },
        { id: 'x', teamId: 't2', after: ['src'] },
      ],
      [
        { id: 'h1', workItemId: 'src', kind: 'handoff', at: at('2026-09-05T10:00') },
        { id: 's1', workItemId: 'src', kind: 'done', at: at('2026-09-22T16:40') },
      ],
    );
    const M = layoutTracker(s, view());
    expect(M.handoffs[0]).toMatchObject({ eventId: 'h1' });
    expect(compareDay(M.window.start, '2026-09-05')).toBeLessThan(0);
  });

  it('makes the Handoff event icon the mark even at the right edge', () => {
    const s = twoTeams(
      [
        { id: 'src', teamId: 't1' },
        { id: 'x', teamId: 't2', after: ['src'] },
        { id: 'y', teamId: 't2', after: ['src'] },
      ],
      [{ id: 'h1', workItemId: 'src', kind: 'handoff', at: at('2026-10-16T22:00') }],
    );
    const M = layoutTracker(s, view());
    const h1 = M.eventGroups.find((g) => g.eventIds.includes('h1'))!;
    expect(M.handoffs[0]).toMatchObject({ groupId: 'h1', x: h1.x - 10, width: 20 });
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

  it('draws a receiving work item that finished before the given window', () => {
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
    expect(W.rows.map((r) => r.id)).toEqual(['src', 'gone']);
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

  it('shows a source or parent that finished before the given window as a row, with no chip', () => {
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
    expect(C.rows.map((r) => r.id)).toEqual(['p', 'c']);
    expect(C.chips).toEqual([]);
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
      x: L.x(ms('2026-09-18T17:00')),
      y: TRUNK_Y,
      status: 'late',
      tone: 'danger',
      stroke: 'danger',
      labelTone: 'danger',
      filled: true,
      icon: 'bang',
      changed: false,
      label: 'CRM integration live · 18 Sept 17:00 · Late',
      ariaLabel: 'CRM integration live · 18 Sept 17:00 · Late',
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
      { milestoneId: 'crm', x1: L.x(ms('2026-09-18T17:00')), x2: xt, y: TRUNK_Y, tone: 'danger' },
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

  it('keeps a label below the axis off the marker of another milestone', () => {
    const milestone = (id: string, name: string, planned: string) => ({
      id,
      name,
      planned,
      firstPlanned: planned,
      moves: [],
    });
    // A moved milestone sits 7 days before the next one: the label of the next one, pushed below
    // the axis by the first label, would run across the first marker.
    const s = buildState({
      milestones: [
        milestone('crm', 'CRM integration live', '2026-10-08'),
        milestone('golive', 'Go-live and first close', '2026-10-15'),
      ],
    });
    const L = layoutTracker(s, view());
    const marker = 8 + 4;
    for (const m of L.milestones.filter((x) => x.level === 1))
      for (const other of L.milestones) {
        if (other === m) continue;
        const clear = m.labelBox.x1 <= other.x - marker || m.labelBox.x0 >= other.x + marker;
        expect(clear, `${m.id} label over the ${other.id} marker`).toBe(true);
      }
    const [a, b] = L.milestones;
    expect(a.level === b.level).toBe(false);
    const apart = a.labelBox.x0 >= b.labelBox.x1 + 8 || a.labelBox.x1 <= b.labelBox.x0 - 8;
    expect(apart || a.level !== b.level).toBe(true);
    for (const m of L.milestones) {
      expect(m.labelBox.x0).toBeGreaterThanOrEqual(X0);
      expect(m.labelBox.x1).toBeLessThanOrEqual(L.x1);
    }
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

describe('layoutTracker: milestone labels never overlap (QA 19 Oct, M1)', () => {
  const extra = (n: number) =>
    [
      { id: 'crs', name: 'CRS release', planned: '2026-10-28' },
      { id: 'audit', name: 'First audit sign-off', planned: '2026-10-20' },
      { id: 'portal', name: 'Investor portal pilot open', planned: '2026-10-23' },
    ]
      .slice(0, n)
      .map((m) => ({ ...m, firstPlanned: m.planned, moves: [] }));
  const widths = [
    { name: '390', over: { side: GEOMETRY.NARROW_SIDE, span: 262 } },
    { name: '1440', over: { span: 1150 } },
  ];

  for (const n of [1, 2, 3]) {
    for (const { name, over } of widths) {
      it(`keeps ${n + 2} close milestones apart at ${name} px`, () => {
        const s = larkspurState();
        s.milestones.push(...extra(n));
        const L = layoutTracker(s, view({ windowEnd: '2026-10-31', ...over }));
        expect(L.milestones).toHaveLength(n + 2);
        for (const m of L.milestones) {
          expect(m.labelBox.x1 - m.labelBox.x0).toBeCloseTo(m.label.length * 5.9, 5);
          if (m.label !== m.ariaLabel)
            expect(m.ariaLabel.startsWith(m.label.replace(/…$/, ''))).toBe(true);
        }
        for (const a of L.milestones)
          for (const b of L.milestones) {
            if (a === b || a.level !== b.level || !a.label || !b.label) continue;
            const apart = a.labelBox.x0 >= b.labelBox.x1 + 8 || a.labelBox.x1 <= b.labelBox.x0 - 8;
            expect(apart, `${name}: ${a.label} | ${b.label}`).toBe(true);
          }
      });
    }
  }

  it('never starts a label under the pinned names or past the right edge, on a phone or a desktop', () => {
    for (const n of [0, 1, 2, 3])
      for (const { over } of widths) {
        const s = larkspurState();
        s.milestones.push(...extra(n));
        const L = layoutTracker(s, view({ windowEnd: '2026-10-31', ...over }));
        for (const m of L.milestones.filter((x) => x.label)) {
          expect(m.labelBox.x0, m.label).toBeGreaterThanOrEqual(X0);
          expect(m.labelBox.x1, m.label).toBeLessThanOrEqual(L.x1);
        }
      }
  });

  it('drops the status, then the date, before it cuts a name', () => {
    const s = larkspurState();
    s.milestones.push(...extra(3));
    const L = layoutTracker(
      s,
      view({ windowEnd: '2026-10-31', side: GEOMETRY.NARROW_SIDE, span: 262 }),
    );
    const short = L.milestones.filter((m) => m.label !== m.ariaLabel);
    expect(short.length).toBeGreaterThan(0);
    for (const m of short) expect(m.label).not.toMatch(/ · (Planned|Late|Done|On time)/);
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
      'legal',
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
      'CRM sync live · 18 Sept 17:00 · Late',
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

describe('layoutTracker: focus on a team', () => {
  it('shows the rows of the team and the work from them, and marks the team focused', () => {
    const L = layoutTracker(
      larkspurState(),
      view({ focusTeam: 'digitization', focusButtons: true }),
    );
    expect(L.rows.map((r) => r.id)).toEqual([
      'analyse',
      'legal',
      'pg201',
      'pg202',
      'pg203',
      'test',
    ]);
    expect(L.lanes[0]).toMatchObject({
      teamId: 'digitization',
      focused: true,
      focusLabel: 'Focus on Digitization',
    });
    expect(L.lanes.slice(1).every((l) => !l.focused)).toBe(true);
    expect(L.rows.every((r) => !r.focused)).toBe(true);
  });

  it('cuts a long team name with an ellipsis before the buttons of its one-line summary row', () => {
    const name = 'Solutions Engineering and Delivery';
    const s = buildState({
      teams: [{ id: 't', name, leadId: null }],
      workItems: [workItem({ id: 'a', teamId: 't' })],
    });
    const plain = layoutTracker(s, view()).lanes[0].label;
    const withButtons = layoutTracker(s, view({ focusButtons: true })).lanes[0].label;
    expect(plain.endsWith('…')).toBe(true);
    expect(withButtons.endsWith('…')).toBe(true);
    expect(withButtons.length).toBeLessThan(plain.length);
    const count = laneNameWidth(' · 1', true);
    expect(laneNameWidth(plain) + count).toBeLessThanOrEqual(174);
    expect(laneNameWidth(withButtons) + count).toBeLessThanOrEqual(155);
    expect(layoutTracker(larkspurState(), view()).lanes[2].label).toBe('SOLUTIONS ENGINEERING');
    const F = layoutTracker(larkspurState(), view({ focusButtons: true }));
    expect(F.lanes[2].label).toMatch(/^SOLUTIONS ENGINEER.*…$/);
    expect(F.lanes[3].label).toBe('ENGINEERING');
  });

  it('lets a work item focus win over a team focus, and ignores an unknown team', () => {
    const both = layoutTracker(larkspurState(), view({ focus: 'pg201', focusTeam: 'it' }));
    expect(both.rows.map((r) => r.id)).toEqual(['pg201', 'test']);
    const unknown = layoutTracker(larkspurState(), view({ focusTeam: 'nope' }));
    expect(unknown.rows).toHaveLength(layoutTracker(larkspurState(), view()).rows.length);
  });
});

describe('windowStartFor: the board shows every event', () => {
  it('moves the project start back to 3 days before the earliest work on the board', () => {
    expect(windowStartFor(larkspurState(), '2026-09-20', AS_OF, TIME_ZONE)).toBe('2026-09-11');
    const L = layoutTracker(
      larkspurState(),
      view({ windowStart: windowStartFor(larkspurState(), '2026-09-20', AS_OF, TIME_ZONE) }),
    );
    for (const id of ['g1', 'g2', 'd1'])
      expect(L.eventGroups.some((g) => g.eventIds.includes(id))).toBe(true);
    expect(L.rows.find((r) => r.id === 'golive')).toBeDefined();
  });

  it('moves the project start back for a work item that finished before it, so its events show', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'T', leadId: null }],
      workItems: [workItem({ id: 'a', teamId: 't' }), workItem({ id: 'old', teamId: 't' })],
      events: [
        event({ id: 'a1', workItemId: 'a', at: at('2026-09-12T09:00') }),
        event({ id: 'o1', workItemId: 'old', at: at('2026-08-01T09:00') }),
        event({ id: 'o2', workItemId: 'old', kind: 'done', at: at('2026-09-01T09:00') }),
      ],
    });
    expect(windowStartFor(s, '2026-09-10', AS_OF, TIME_ZONE)).toBe('2026-07-29');
  });

  it('counts the start of a work item without events, and leaves an unset start to the layout', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'T', leadId: null }],
      workItems: [workItem({ id: 'a', teamId: 't', since: at('2026-09-01T09:00') })],
    });
    expect(windowStartFor(s, '2026-09-10', AS_OF, TIME_ZONE)).toBe('2026-08-29');
    expect(windowStartFor(s, null, AS_OF, TIME_ZONE)).toBeUndefined();
  });
});

describe('the time range covers every event, work item and milestone (round 24)', () => {
  const months = () =>
    buildState({
      teams: [{ id: 't', name: 'T', leadId: null }],
      workItems: [
        workItem({ id: 'a', teamId: 't', plannedFinish: '2026-10-05' }),
        workItem({ id: 'old', teamId: 't', plannedFinish: '2026-06-02' }),
      ],
      milestones: [
        { id: 'far', name: 'Far', planned: '2026-12-20', firstPlanned: '2026-12-20', moves: [] },
      ],
      events: [
        event({ id: 'a1', workItemId: 'a', at: at('2026-09-12T09:00') }),
        event({ id: 'o1', workItemId: 'old', at: at('2026-05-28T09:00') }),
        event({ id: 'o2', workItemId: 'old', kind: 'done', at: at('2026-06-01T09:00') }),
      ],
    });

  it('draws an event months before the project start, at Fit and when the view gives a later window', () => {
    for (const v of [view({ windowStart: undefined, windowEnd: undefined }), view()]) {
      const L = layoutTracker(months(), v);
      expect(L.rows.map((r) => r.id)).toEqual(['a', 'old']);
      for (const id of ['a1', 'o1', 'o2']) {
        const g = L.eventGroups.find((x) => x.eventIds.includes(id));
        expect(g, id).toBeDefined();
        expect(g!.x).toBeGreaterThanOrEqual(X0);
        expect(g!.x).toBeLessThanOrEqual(L.x1);
      }
      expect(compareDay(L.window.start, '2026-05-28')).toBeLessThan(0);
      expect(L.milestones[0].x).toBeLessThanOrEqual(L.x1);
    }
  });

  it('shows every work item and every event of the seed, and each team count equals its rows', () => {
    const s = larkspurState();
    const L = layoutTracker(
      s,
      view({ windowStart: windowStartFor(s, '2026-09-13', AS_OF, TIME_ZONE) }),
    );
    expect(L.rows.map((r) => r.id).sort()).toEqual(s.workItems.map((w) => w.id).sort());
    for (const e of s.events) {
      const g = L.eventGroups.find((x) => x.eventIds.includes(e.id));
      expect(g, e.id).toBeDefined();
      expect(g!.x).toBeGreaterThanOrEqual(X0);
    }
    // The team count on screen is the number of its shown rows, so it must equal its work items.
    for (const team of s.teams) {
      const rows = L.rows.filter((r) => r.teamId === team.id);
      expect(rows.length, team.id).toBe(s.workItems.filter((w) => w.teamId === team.id).length);
    }
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
    expect(L.rows).toHaveLength(15);
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

const LEVELS: Array<[Density, number, number]> = [
  ['comfortable', 32, 28],
  ['compact', 20, 28],
  ['dense', 12, 24],
];

describe('layoutTracker: row height', () => {
  it.each(LEVELS)('steps %s rows by %i units under a summary row of %i', (density, row, head) => {
    const L = layoutTracker(larkspurState(), view({ density }));
    expect(L.level).toBe(ROW_LEVELS[density]);
    expect(L.level.row).toBe(row);
    const lane = L.lanes[0];
    expect(lane.head).toBe(head);
    const ys = L.rows.filter((r) => r.teamId === 'implementation').map((r) => r.y);
    expect(ys).toEqual([0, 1, 2].map((i) => lane.top + head + row / 2 + i * row));
    expect(lane.bottom).toBe(lane.top + head + 3 * row + 6);
    expect(L.lanes[1].top).toBe(lane.bottom);
  });

  it('keeps Comfortable when the view names no row height', () => {
    expect(layoutTracker(larkspurState(), view()).level).toBe(ROW_LEVELS.comfortable);
  });

  it.each(LEVELS)('keeps every %s mark inside its own row band', (density, row) => {
    const L = layoutTracker(larkspurState(), view({ density, zoom: 4 }));
    const { r, chip, mark, diamond, nameFont } = L.level;
    expect(2 * r).toBeLessThanOrEqual(row - 2);
    expect(2 * diamond).toBeLessThanOrEqual(row - 2);
    expect(chip).toBeLessThanOrEqual(row - 2);
    expect(mark).toBeLessThanOrEqual(row - 2);
    for (const h of L.handoffs) expect(h.height).toBeLessThanOrEqual(row - 2);
    for (const c of L.chips) expect(c.size).toBe(chip);
    for (const d of L.deadlines.filter((x) => x.label)) {
      expect(d.labelY - 0.72 * nameFont).toBeGreaterThanOrEqual(d.y - row / 2);
      expect(d.labelY).toBeLessThanOrEqual(d.y + row / 2);
    }
    expect(L.level.hit).toBeGreaterThanOrEqual(12);
  });

  it('stacks events closer than 16, 12 or 7 units', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      workItems: [workItem({ id: 'a', teamId: 't', plannedFinish: '2026-10-15' })],
      events: [
        event({ id: 'e1', workItemId: 'a', at: at('2026-10-01T00:00') }),
        event({ id: 'e2', workItemId: 'a', at: at('2026-10-01T10:00') }),
        event({ id: 'e3', workItemId: 'a', at: at('2026-10-02T00:00') }),
      ],
    });
    const stacks = (density: Density) =>
      layoutTracker(s, view({ density })).eventGroups.map((g) => g.eventIds);
    // 10 hours is about 9 units and 14 hours about 13 at this window.
    expect(stacks('comfortable')).toEqual([['e1', 'e2', 'e3']]);
    expect(stacks('compact')).toEqual([['e1', 'e2'], ['e3']]);
    expect(stacks('dense')).toEqual([['e1'], ['e2'], ['e3']]);
  });

  it('shows the waiting text above the line only where the row has room for it', () => {
    expect(ROW_LEVELS.comfortable.waitText).toBe(true);
    expect(ROW_LEVELS.compact.waitText).toBe(true);
    expect(ROW_LEVELS.dense.waitText).toBe(false);
    const L = layoutTracker(larkspurState(), view({ density: 'compact' }));
    const wait = L.segments.find((x) => x.kind === 'wait')!;
    expect(wait.kind === 'wait' && wait.textY).toBe(wait.y - ROW_LEVELS.compact.waitRise);
  });

  it.each(LEVELS)('keeps a %s milestone name off the + button of an editable view', (density) => {
    const plain = layoutTracker(larkspurState(), view());
    // Without the button the name of Go-live sits where the button goes.
    expect(plain.deadlines.find((d) => d.workItemId === 'golive')!.label).not.toBeNull();
    const L = layoutTracker(larkspurState(), view({ density, plusButtons: true }));
    const plus = L.x(Date.parse(AS_OF)) + 20;
    const room = L.level.plus + 2;
    for (const d of L.deadlines.filter(
      (x) => x.label && !L.rows.find((r) => r.id === x.workItemId)!.done,
    )) {
      const width = d.label!.length * 5.4 * (L.level.nameFont / 9.5);
      const [a, b] =
        d.labelAnchor === 'start' ? [d.labelX, d.labelX + width] : [d.labelX - width, d.labelX];
      expect(b < plus - room || a > plus + room).toBe(true);
    }
  });

  it.each(LEVELS)('keeps a %s waiting text off the + button of an editable view', (density) => {
    const state = buildState({
      teams: [{ id: 'team', name: 'Team', leadId: null }],
      workItems: [
        workItem({ id: 'above', plannedFinish: '2026-10-20' }),
        workItem({ id: 'placed', since: AS_OF, plannedFinish: '2026-10-20' }),
      ],
    });
    const waitOf = (L: TrackerLayout) =>
      L.segments.find(
        (x): x is Extract<LayoutSegment, { kind: 'wait' }> =>
          x.kind === 'wait' && x.workItemId === 'placed',
      )!;
    const plain = waitOf(layoutTracker(state, view({ density })));
    expect(plain.textX).toBe(plain.x1 + 8);
    const L = layoutTracker(state, view({ density, plusButtons: true }));
    const wait = waitOf(L);
    const plus = L.tLine.x + 20;
    expect(wait.textX).toBeGreaterThan(plus + L.level.plus);
    expect(wait.textX + wait.text.length * 5.6).toBeLessThanOrEqual(L.width);
  });

  it.each([
    ['comfortable', false],
    ['compact', false],
    ['comfortable', true],
    ['compact', true],
  ] as const)(
    'starts a %s waiting text after the handoff mark of its own row (+ buttons: %s)',
    (density, plusButtons) => {
      const state = buildState({
        teams: [
          { id: 'design', name: 'Design', leadId: null },
          { id: 'web', name: 'Web', leadId: null },
          { id: 'qa', name: 'QA', leadId: null },
        ],
        workItems: [
          workItem({ id: 'homepage', title: 'Homepage design', teamId: 'design' }),
          workItem({
            id: 'build',
            title: 'Build the homepage',
            teamId: 'web',
            after: ['homepage'],
          }),
          workItem({ id: 'test', title: 'Test the homepage', teamId: 'qa', after: ['build'] }),
        ],
        events: [event({ id: 'e1', workItemId: 'homepage', kind: 'task' })],
      });
      for (const since of [undefined, AS_OF]) {
        const shaped = since
          ? {
              ...state,
              workItems: state.workItems.map((w) => (w.id === 'build' ? { ...w, since } : w)),
            }
          : state;
        const L = layoutTracker(shaped, view({ density, plusButtons }));
        const wait = L.segments.find(
          (x): x is Extract<LayoutSegment, { kind: 'wait' }> =>
            x.kind === 'wait' && x.workItemId === 'build',
        )!;
        expect(wait.text).toBe('Waiting for Homepage');
        const mark = L.handoffs.find((h) => h.fromId === 'build')!;
        expect(mark.wait).toBe(true);
        const end = wait.textX + wait.text.length * 5.6;
        expect(end <= mark.x || wait.textX >= mark.x + mark.width).toBe(true);
        expect(end).toBeLessThanOrEqual(L.width);
      }
      // A window that ends just after T leaves no room after the mark for the whole text.
      const edges: Array<[string, number]> = [['2026-10-11', 1]];
      if (plusButtons && density === 'compact') edges.push(['2026-10-12', 1]);
      if (plusButtons && density === 'comfortable') edges.push(['2026-10-11', 2]);
      for (const [windowEnd, zoom] of edges) {
        const edge = layoutTracker(state, view({ density, plusButtons, windowEnd, zoom }));
        const cut = edge.segments.find(
          (x): x is Extract<LayoutSegment, { kind: 'wait' }> =>
            x.kind === 'wait' && x.workItemId === 'build',
        )!;
        const mark = edge.handoffs.find((h) => h.fromId === 'build')!;
        const end = cut.textX + cut.text.length * 5.6;
        const clear = (a: number, b: number) => end <= a || cut.textX >= b;
        expect(clear(mark.x, mark.x + mark.width)).toBe(true);
        const plus = edge.tLine.x + 20;
        if (plusButtons) expect(clear(plus - edge.level.plus, plus + edge.level.plus)).toBe(true);
        expect(cut.text === 'Waiting for Homepage' || /^Waiting.*…$/.test(cut.text)).toBe(true);
        expect(cut.textX).toBeGreaterThanOrEqual(GEOMETRY.X0);
        expect(end).toBeLessThanOrEqual(edge.width);
      }
    },
  );

  it('puts a Dense milestone name only where the row has no line', () => {
    const L = layoutTracker(larkspurState(), view({ density: 'dense', zoom: 4 }));
    const named = L.deadlines.filter((d) => d.label);
    expect(named.length).toBeGreaterThan(0);
    for (const d of named) {
      const width = d.label!.length * 5.4 * (ROW_LEVELS.dense.nameFont / 9.5);
      const [a, b] =
        d.labelAnchor === 'start' ? [d.labelX, d.labelX + width] : [d.labelX - width, d.labelX];
      const lines = L.segments.filter((x) => x.workItemId === d.workItemId);
      for (const line of lines) expect(b < line.x1 || a > line.x2).toBe(true);
    }
  });
});

describe('layoutTracker: team summary rows', () => {
  const L = layoutTracker(larkspurState(), view());
  const lane = (id: string, M = L) => M.lanes.find((l) => l.teamId === id)!;

  it('counts late, not yet and done work items, and names only the counts above zero', () => {
    expect(lane('engineering').summary).toMatchObject({
      count: 4,
      late: 2,
      notYet: 0,
      done: 2,
      ariaLabel: 'Engineering, 4 work items: 2 late, 2 done',
    });
    expect(lane('implementation').summary).toMatchObject({
      count: 3,
      late: 0,
      notYet: 2,
      done: 1,
      ariaLabel: 'Implementation, 3 work items: 2 not yet, 1 done',
    });
  });

  it('leaves the lane right of the summary row empty: no bar and no event ticks', () => {
    for (const l of L.lanes) {
      expect(l.summary).not.toHaveProperty('bar');
      expect(l.summary).not.toHaveProperty('ticks');
    }
  });

  it('puts every summary row on one line: no second line for the counts', () => {
    for (const l of L.lanes) expect(l).not.toHaveProperty('oneLine');
  });

  it('cuts a Vietnamese name by grapheme, in NFC, and keeps every mark on its letter', () => {
    const name = 'Phát triển Sản phẩm và Dịch vụ Khách hàng Quốc tế'.normalize('NFD');
    const s = buildState({
      teams: [{ id: 't', name, leadId: null }],
      workItems: [workItem({ id: 'a', teamId: 't' })],
    });
    const label = layoutTracker(s, view({ focusButtons: true })).lanes[0].label;
    const full = name.normalize('NFC').toUpperCase();
    expect(label.endsWith('…')).toBe(true);
    expect(label).toBe(label.normalize('NFC'));
    expect(full.startsWith(label.slice(0, -1).trimEnd())).toBe(true);
    expect(label).not.toMatch(/\p{M}…$/u);
    expect(label).toMatch(/^PHÁT TRIỂN/);
    expect(laneNameWidth(label) + laneNameWidth(' · 1', true)).toBeLessThanOrEqual(155);
  });

  it('never cuts inside a grapheme: a letter with a mark that has no single code point, or an emoji', () => {
    for (let room = 10; room < 60; room += 3) {
      const marked = cutToWidth('X\u030CX\u030CX\u030CX\u030CX\u030CX\u030CX\u030C', room);
      expect(marked).not.toMatch(/X…|\u030C\u030C/);
      expect(marked.replace('…', '')).toMatch(/^(X\u030C)*$/);
      const emoji = cutToWidth('🚀🚀🚀🚀🚀🚀🚀🚀 ROCKET', room);
      expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(emoji).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    expect(cutToWidth('ĐỘI NGŨ', 200)).toBe('ĐỘI NGŨ');
  });

  // Geist 10.5px as the browser measured it (18 Oct): the estimate may be a little wide, never narrow.
  it.each([
    ['IMPLEMENTATION', 3, 115],
    ['DIGITIZATION', 2, 89],
    ['SOLUTIONS ENGINEERING', 2, 162],
    ['ENGINEERING', 4, 93],
    ['DIGITIZATION QA', 1, 107],
    ['CUSTOMER SUCCESS', 1, 134],
    ['IT', 1, 22],
  ])('estimates the width of "%s · %i" within 8 %% above the measure', (name, n, real) => {
    const w = laneNameWidth(name) + laneNameWidth(` · ${n}`, true);
    expect(w).toBeGreaterThanOrEqual(real);
    expect(w).toBeLessThanOrEqual(real * 1.08);
  });

  it('gives a collapsed team its summary row only, and no rows, lines or events', () => {
    const C = layoutTracker(larkspurState(), view({ collapsedTeams: new Set(['implementation']) }));
    const imp = lane('implementation', C);
    expect(imp.collapsed).toBe(true);
    expect(imp.bottom).toBe(imp.top + imp.head + 2);
    expect(imp.guide).toBeNull();
    expect(imp.summary.count).toBe(3);
    expect(C.rows.some((r) => r.teamId === 'implementation')).toBe(false);
    expect(C.segments.some((x) => ['golive', 'crs', 'rehearsal'].includes(x.workItemId))).toBe(
      false,
    );
    expect(C.lanes[1].top).toBe(imp.bottom);
    expect(C.height).toBe(L.height - (lane('implementation').bottom - imp.bottom));
    expect(lane('engineering').collapsed).toBe(false);
  });

  it('keeps a team with no work items open, as a drop target', () => {
    const s = buildState({ teams: [{ id: 't', name: 'Team', leadId: null }] });
    const E = layoutTracker(s, view({ collapsedTeams: new Set(['t']) }));
    expect(E.lanes[0]).toMatchObject({
      collapsed: false,
      summary: { count: 0, ariaLabel: 'Team, 0 work items' },
    });
  });

  it('keeps the receivers in a collapsed team on the handoff mark, with their team', () => {
    const C = layoutTracker(
      larkspurState(),
      view({ collapsedTeams: new Set(['digitization-qa']) }),
    );
    expect(C.handoffs.find((h) => h.fromId === 'pg203')!.targets).toMatchObject([
      { id: 'test', team: 'Digitization QA' },
    ]);
  });

  it('flags the summary of a team that holds a change of the change request', () => {
    const marks = { ...noMarks(), events: new Set(['p31']) };
    const C = layoutTracker(
      larkspurState(),
      view({ collapsedTeams: new Set(['engineering']) }),
      marks,
    );
    expect(lane('engineering', C).summary.changed).toBe(true);
    expect(lane('engineering', C).summary.ariaLabel).toBe(
      'Engineering, 4 work items: 2 late, 2 done, changed in this change request',
    );
    expect(lane('implementation', C).summary.changed).toBe(false);
    expect(lane('engineering').summary.changed).toBe(false);
  });

  it('says in the chip that a source sits in a collapsed team', () => {
    const C = layoutTracker(larkspurState(), view({ collapsedTeams: new Set(['implementation']) }));
    expect(C.chips.find((c) => c.workItemId === 'analyse')!.tooltip).toBe(
      'From CRS tax residency section with DealCloud sync (in Implementation, collapsed)',
    );
  });
});
