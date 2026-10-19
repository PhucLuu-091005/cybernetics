import { describe, expect, it } from 'vitest';
import { openScale } from '../../../src/components/tracker/scale';
import { demoClock } from '../../../src/server/tracker/projects';
import {
  LARKSPUR_STORY_NOW,
  LARKSPUR_WINDOW_START,
  larkspurCrs,
  larkspurShift,
  larkspurState,
} from '../../../src/server/tracker/seed/larkspur';
import {
  itemStatus,
  layoutTracker,
  replayOps,
  windowStartFor,
  type TrackerState,
  type View,
} from '../../../src/tracker';
import { AS_OF, TIME_ZONE } from '../../support/tracker-fixture';

// The time line of the graph at 1440 px with the rail open (measured in the browser).
const DESKTOP_SPAN = 988;
// Two event marks closer than this touch at the default row height.
const CLEAR = 2;
// The examples of a crowd: a task and its handoff in one hour, and a rehearsal in one afternoon.
const CROWDS = ['crs', 'rehearsal'];

const main = (): TrackerState => replayOps(larkspurState(), larkspurCrs()[0].ops).state;

function defaultView(state: TrackerState) {
  const view: View = {
    hiddenRows: new Set(),
    hiddenTeams: new Set(),
    asOf: AS_OF,
    timeZone: TIME_ZONE,
    windowStart: windowStartFor(state, LARKSPUR_WINDOW_START, AS_OF, TIME_ZONE),
    span: DESKTOP_SPAN,
    fitSpan: DESKTOP_SPAN,
    density: 'comfortable',
  };
  const fit = layoutTracker(state, view);
  return { fit, layout: layoutTracker(state, { ...view, dayWidth: openScale(fit).dayWidth }) };
}

describe('the Larkspur seed on the default graph', () => {
  it('covers five weeks, so the first view at 1440 px shows the whole story', () => {
    const { fit, layout } = defaultView(main());
    expect(fit.window).toMatchObject({ start: '2026-09-13', end: '2026-10-19' });
    expect(layout.dayWidth).toBe(fit.fitDayWidth);
    expect(layout.width).toBeLessThanOrEqual(fit.width);
  });

  it('keeps the events of each row apart, except the two crowd examples', () => {
    const { layout } = defaultView(main());
    const { r } = layout.level;
    const crowded = new Set<string>();
    const touching: string[] = [];
    for (const row of layout.rows) {
      const groups = layout.eventGroups
        .filter((g) => g.workItemId === row.id)
        .sort((a, b) => a.x - b.x);
      if (groups.some((g) => g.eventIds.length > 1)) crowded.add(row.id);
      for (const [i, g] of groups.entries())
        if (i > 0 && g.x - groups[i - 1].x < 2 * r + CLEAR)
          touching.push(`${groups[i - 1].topId}-${g.topId}`);
    }
    expect([...crowded].sort()).toEqual(CROWDS);
    expect(touching).toEqual([]);
    expect(layout.rows.length).toBe(14);
  });

  it('keeps the mix of statuses and event kinds', () => {
    const state = main();
    const statuses = new Set(
      state.workItems.map((w) => itemStatus(w, state.events, AS_OF, TIME_ZONE)),
    );
    expect([...statuses].sort()).toEqual([
      'cancelled',
      'early',
      'flate',
      'late',
      'ontime',
      'planned',
    ]);
    const kinds = new Set(state.events.map((e) => e.kind));
    expect([...kinds].sort()).toEqual([
      'cancelled',
      'decision',
      'delivery',
      'done',
      'handoff',
      'idea',
      'issue',
      'meeting',
      'message',
      'task',
    ]);
  });
});

describe('a copy of the Larkspur story', () => {
  const NOW = LARKSPUR_STORY_NOW;
  const HOUR = 3_600_000;
  const instant = (iso: string) => new Date(iso);
  const every = (state: TrackerState) => [
    ...state.events.map((e) => e.at),
    ...state.queue.events.flatMap((e) => [e.at, e.createdAt]),
    ...state.queue.items.map((q) => q.createdAt),
    ...state.workItems.flatMap((w) => w.moves.map((m) => m.at)),
  ];

  it('moves by whole days, so the end of the story lands in the last day before the copy', () => {
    expect(larkspurShift(instant(NOW))).toBe(0);
    expect(larkspurShift(new Date(Date.parse(NOW) + 23 * HOUR))).toBe(0);
    expect(larkspurShift(new Date(Date.parse(NOW) + 24 * HOUR))).toBe(1);
    expect(larkspurShift(instant('2026-10-19T10:00:00+07:00'))).toBe(9);
    expect(larkspurShift(instant('2026-10-19T18:30:00+07:00'))).toBe(10);
    expect(larkspurShift(instant('2026-09-01T08:00:00+07:00'))).toBe(-39);
  });

  it('keeps the time of day of each event and moves every date and every date in the text', () => {
    const copy = larkspurState(undefined, 10);
    const story = larkspurState();
    const g2 = copy.events.find((e) => e.id === 'g2')!;
    expect(g2.at).toBe('2026-09-25T10:45:00+07:00');
    expect(g2.text).toBe('Go-live is set for 10 October.');
    expect(story.events.find((e) => e.id === 'g2')!.text).toBe('Go-live is set for 30 September.');
    expect(copy.workItems.find((w) => w.id === 'golive')).toMatchObject({
      plannedFinish: '2026-10-25',
      firstPlannedFinish: '2026-10-10',
      moves: [
        {
          from: '2026-10-10',
          to: '2026-10-25',
          why: 'The CRS section is not ready. Sarah agreed to 25 October on 6 October.',
          at: '2026-10-06T09:30:00+07:00',
        },
      ],
    });
    expect(copy.milestones.map((m) => [m.planned, m.firstPlanned])).toEqual([
      ['2026-09-28', '2026-09-28'],
      ['2026-10-10', '2026-10-10'],
    ]);
    expect(copy.queue.items.map((q) => q.plannedFinish)).toEqual(['2026-10-24', '2026-10-30']);
    for (const text of [...copy.events, ...copy.queue.events].map((e) => e.text))
      expect(text).not.toMatch(/[{}]|\d{4}-\d{2}-\d{2}/);
    const [first] = larkspurCrs(undefined, 10);
    expect(first.createdAt).toBe('2026-10-18T16:50:00+07:00');
    expect(first.ops[1].a).toMatchObject({
      date: '2026-10-25',
      why: 'The CRS section is not ready. Sarah agreed on 6 October.',
    });
  });

  it('puts the copy made at any hour before its own now, with the same mix of statuses', () => {
    const story = main();
    const at = (state: TrackerState, asOf: string) =>
      state.workItems.map((w) => [w.id, itemStatus(w, state.events, asOf, TIME_ZONE)]);
    for (const made of ['2026-10-19T08:00:00+07:00', '2026-10-19T18:00:00+07:00']) {
      const days = larkspurShift(instant(made));
      const copy = replayOps(
        larkspurState(undefined, days),
        larkspurCrs(undefined, days)[0].ops,
      ).state;
      for (const iso of every(copy)) expect(Date.parse(iso)).toBeLessThanOrEqual(Date.parse(made));
      for (const cr of larkspurCrs(undefined, days))
        for (const c of cr.comments) expect(Date.parse(c.at)).toBeLessThanOrEqual(Date.parse(made));
      expect(at(copy, made)).toEqual(at(story, AS_OF));
    }
  });
});

describe('demoClock', () => {
  it('copies the story at the real time with no fixed clock', () => {
    const before = Date.now();
    const clock = demoClock({});
    expect(clock.asOf).toBeNull();
    expect(clock.now.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('pins the copy and the project clock for tests, and refuses the pin in production', () => {
    const pin = { TRACKER_DEMO_AS_OF: LARKSPUR_STORY_NOW };
    expect(demoClock(pin)).toEqual({ now: new Date(LARKSPUR_STORY_NOW), asOf: LARKSPUR_STORY_NOW });
    expect(() => demoClock({ ...pin, NODE_ENV: 'production' })).toThrow(/tests only/);
    expect(() => demoClock({ TRACKER_DEMO_AS_OF: 'soon' })).toThrow(/ISO instant/);
  });
});
