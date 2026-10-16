import { describe, expect, it } from 'vitest';
import {
  dayAtX,
  dropAction,
  noonX,
  retarget,
  targetAt,
  type DragSource,
} from '../../../src/components/tracker/drag';
import { GEOMETRY, layoutTracker, type View } from '../../../src/tracker/layout';
import type { TrackerState } from '../../../src/tracker/model';
import { AS_OF, TIME_ZONE, buildState, event, workItem } from '../../support/tracker-fixture';

const { X0, X1 } = GEOMETRY;

const state = (): TrackerState =>
  buildState({
    people: [{ id: 'doer', name: 'Dana Doer' }],
    teams: [
      { id: 'eng', name: 'Engineering', leadId: null },
      { id: 'qa', name: 'QA', leadId: null },
    ],
    milestones: [
      {
        id: 'golive',
        name: 'Go-live',
        planned: '2026-10-15',
        firstPlanned: '2026-10-15',
        moves: [],
      },
    ],
    workItems: [
      workItem({ id: 'a', teamId: 'eng', milestoneId: 'golive' }),
      workItem({ id: 'b', teamId: 'eng' }),
      workItem({ id: 'c', teamId: 'qa', plannedFinish: '2026-10-12' }),
    ],
    events: [event({ id: 'e1', workItemId: 'a' }), event({ id: 'e2', workItemId: 'b' })],
  });

const view = (over: Partial<View> = {}): View => ({
  hiddenRows: new Set(),
  hiddenTeams: new Set(),
  asOf: AS_OF,
  timeZone: TIME_ZONE,
  windowStart: '2026-09-10',
  windowEnd: '2026-10-17',
  ...over,
});

const layout = (over: Partial<View> = {}) => layoutTracker(state(), view(over));
const rowY = (L: ReturnType<typeof layout>, id: string) => L.rows.find((r) => r.id === id)!.y;
const lane = (L: ReturnType<typeof layout>, id: string) => L.lanes.find((l) => l.teamId === id)!;

describe('targetAt: the drop target under a point of the graph', () => {
  it('finds a milestone diamond', () => {
    const L = layout();
    const m = L.milestones[0];
    expect(targetAt(L, { x: m.x + 10, y: m.y - 10 })).toEqual({ type: 'ms', id: 'golive' });
    expect(targetAt(L, { x: m.x + 16, y: m.y })).not.toEqual({ type: 'ms', id: 'golive' });
  });

  it('finds a milestone by its label, as the prototype does', () => {
    const L = layout();
    const m = L.milestones[0];
    const mid = (m.labelBox.x0 + m.labelBox.x1) / 2;
    expect(targetAt(L, { x: mid, y: m.labelY - 4 })).toEqual({ type: 'ms', id: 'golive' });
    expect(targetAt(L, { x: mid, y: m.labelY + 12 })).toBeNull();
  });

  it('finds the drop strip at the head of a team', () => {
    const L = layout();
    const qa = lane(L, 'qa');
    expect(targetAt(L, { x: X0 + 40, y: qa.top + 10 })).toEqual({ type: 'lane', teamId: 'qa' });
  });

  it('finds a work item row, in the label column and on the time line', () => {
    const L = layout();
    const y = rowY(L, 'b');
    expect(targetAt(L, { x: 60, y })).toEqual({ type: 'loop', id: 'b' });
    expect(targetAt(L, { x: X0 + 300, y: y + 14 })).toEqual({ type: 'loop', id: 'b' });
    expect(targetAt(L, { x: X1, y: y - 14 })).toEqual({ type: 'loop', id: 'b' });
  });

  it('falls back to the team band outside a row', () => {
    const L = layout();
    const eng = lane(L, 'eng');
    expect(targetAt(L, { x: X0 + 300, y: eng.bottom - 2 })).toEqual({
      type: 'lane',
      teamId: 'eng',
    });
    expect(targetAt(L, { x: 4, y: eng.top + 30 })).toEqual({ type: 'lane', teamId: 'eng' });
  });

  it('maps a folded row and a hidden team to their team band', () => {
    const L = layout({ hiddenRows: new Set(['b']), hiddenTeams: new Set(['qa']) });
    expect(targetAt(L, { x: X0 + 300, y: rowY(L, 'b') })).toEqual({ type: 'lane', teamId: 'eng' });
    expect(targetAt(L, { x: X0 + 300, y: lane(L, 'qa').top + 26 })).toEqual({
      type: 'lane',
      teamId: 'qa',
    });
  });

  it('finds nothing above the teams or below the graph', () => {
    const L = layout();
    expect(targetAt(L, { x: X0 + 40, y: 6 })).toBeNull();
    expect(targetAt(L, { x: X0 + 40, y: L.height + 10 })).toBeNull();
  });
});

describe('retarget: a queue work item lands on a team', () => {
  it('turns a work item row into its team', () => {
    const s = state();
    const item: DragSource = { kind: 'queueItem', id: 'q1' };
    expect(retarget(item, { type: 'loop', id: 'c' }, s)).toEqual({ type: 'lane', teamId: 'qa' });
    expect(retarget(item, { type: 'ms', id: 'golive' }, s)).toEqual({ type: 'ms', id: 'golive' });
  });

  it('keeps the target for other sources', () => {
    const s = state();
    const ev: DragSource = { kind: 'queueEvent', id: 'qe1' };
    expect(retarget(ev, { type: 'loop', id: 'c' }, s)).toEqual({ type: 'loop', id: 'c' });
    expect(retarget(ev, null, s)).toBeNull();
  });
});

describe('dropAction: what a drop does', () => {
  const s = state();
  const qe: DragSource = { kind: 'queueEvent', id: 'qe1' };
  const qi: DragSource = { kind: 'queueItem', id: 'q1' };
  const ev: DragSource = { kind: 'event', id: 'e1', from: 'a' };
  const row: DragSource = { kind: 'row', id: 'b' };

  it('attaches a queue event to a work item, opens a new work item on a team, removes it in the bin', () => {
    expect(dropAction(qe, { type: 'loop', id: 'b' }, s)).toEqual({
      kind: 'op',
      op: { op: 'attach', a: { eventId: 'qe1', workItemId: 'b' } },
    });
    expect(dropAction(qe, { type: 'lane', teamId: 'qa' }, s)).toEqual({
      kind: 'fromEvent',
      eventId: 'qe1',
      teamId: 'qa',
    });
    expect(dropAction(qe, { type: 'bin' }, s)).toEqual({ kind: 'dismiss', id: 'qe1' });
    expect(dropAction(qe, { type: 'ms', id: 'golive' }, s)).toEqual({ kind: 'none' });
    expect(dropAction(qe, null, s)).toEqual({ kind: 'none' });
  });

  it('places a queue work item on a team, sets its milestone on a diamond, removes it in the bin', () => {
    expect(dropAction(qi, { type: 'lane', teamId: 'eng' }, s)).toEqual({
      kind: 'op',
      op: { op: 'place', a: { itemId: 'q1', teamId: 'eng' } },
    });
    expect(dropAction(qi, { type: 'ms', id: 'golive' }, s)).toEqual({
      kind: 'op',
      op: { op: 'qms', a: { itemId: 'q1', milestoneId: 'golive' } },
    });
    expect(dropAction(qi, { type: 'bin' }, s)).toEqual({ kind: 'dismiss', id: 'q1' });
  });

  it('moves an event to another work item and hides it in the bin', () => {
    expect(dropAction(ev, { type: 'loop', id: 'c' }, s)).toEqual({
      kind: 'op',
      op: { op: 'move', a: { eventId: 'e1', to: 'c' } },
    });
    expect(dropAction(ev, { type: 'bin' }, s)).toEqual({
      kind: 'op',
      op: { op: 'hide', a: { eventId: 'e1' } },
    });
    expect(dropAction(ev, { type: 'loop', id: 'a' }, s)).toEqual({ kind: 'none' });
  });

  it('explains that an event keeps its time when it moves sideways', () => {
    expect(dropAction(ev, { type: 'loop', id: 'a' }, s, 60)).toEqual({
      kind: 'hint',
      text: 'An event stays at the time it happened. Drag it up or down to another work item.',
    });
    expect(dropAction(ev, null, s, -41).kind).toBe('hint');
    expect(dropAction(ev, null, s, 40)).toEqual({ kind: 'none' });
  });

  it('adds a work item to the milestone under its name', () => {
    expect(dropAction(row, { type: 'ms', id: 'golive' }, s)).toEqual({
      kind: 'op',
      op: { op: 'msAdd', a: { workItemId: 'b', milestoneId: 'golive' } },
    });
    expect(dropAction({ kind: 'row', id: 'a' }, { type: 'ms', id: 'golive' }, s)).toEqual({
      kind: 'none',
    });
    expect(dropAction(row, { type: 'lane', teamId: 'qa' }, s)).toEqual({
      kind: 'hint',
      text: 'Drop a work item name on a milestone diamond to add it to that milestone.',
    });
    expect(dropAction(row, null, s)).toEqual({ kind: 'none' });
  });
});

describe('dayAtX and noonX: the day under a dragged date flag', () => {
  it('reads the day at the noon of a flag', () => {
    const L = layout();
    const flag = L.flags.find((f) => f.workItemId === 'c')!;
    expect(noonX(L, '2026-10-12', TIME_ZONE)).toBeCloseTo(flag.x, 6);
    expect(dayAtX(L, flag.x, TIME_ZONE)).toBe('2026-10-12');
    expect(dayAtX(L, noonX(L, '2026-09-20', TIME_ZONE) + 8, TIME_ZONE)).toBe('2026-09-20');
  });

  it('keeps the day inside the window', () => {
    const L = layout();
    expect(dayAtX(L, 0, TIME_ZONE)).toBe('2026-09-11');
    expect(dayAtX(L, X1 + 500, TIME_ZONE)).toBe('2026-10-16');
  });

  it('matches the milestone diamond position', () => {
    const L = layout();
    expect(noonX(L, '2026-10-15', TIME_ZONE)).toBeCloseTo(L.milestones[0].x, 6);
  });
});
