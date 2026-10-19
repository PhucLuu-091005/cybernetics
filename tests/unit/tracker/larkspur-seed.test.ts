import { describe, expect, it } from 'vitest';
import { openScale } from '../../../src/components/tracker/scale';
import {
  LARKSPUR_WINDOW_START,
  larkspurCrs,
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
