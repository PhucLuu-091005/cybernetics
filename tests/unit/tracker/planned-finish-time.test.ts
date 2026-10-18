import { describe, expect, it } from 'vitest';
import { clashesOf, type Commit } from '../../../src/tracker/clash';
import { itemDeadline } from '../../../src/tracker/deadline';
import { describeOp, diffLines } from '../../../src/tracker/describe';
import { layoutTracker, type LayoutSegment, type View } from '../../../src/tracker/layout';
import { applyOp, sameOp } from '../../../src/tracker/ops';
import {
  DueArgsSchema,
  FromEventArgsSchema,
  OpSchema,
  PlaceArgsSchema,
  QueueItemInputSchema,
  TrackerBaseSchema,
  WorkItemSchema,
} from '../../../src/tracker/schemas';
import { itemStatus } from '../../../src/tracker/status';
import type { QueueItem, WorkItem } from '../../../src/tracker/model';
import {
  AS_OF,
  at,
  buildState,
  event,
  larkspurBase,
  larkspurState,
  makeOp,
  TIME_ZONE,
  workItem,
} from '../../support/tracker-fixture';

const WHY = 'The tax team reviews the form at five.';
const dueTo = (date: string, time?: string, rev = 0, by = 'minh') =>
  makeOp(
    'due',
    {
      workItemId: 'pg203',
      date,
      ...(time ? { time } : {}),
      why: WHY,
      by,
      at: at('2026-10-08T16:55'),
    },
    rev,
    by,
  );

describe('planned finish time: data', () => {
  const pg203 = larkspurBase().workItems.find((w) => w.id === 'pg203')!;

  it('keeps a stored work item without a time valid', () => {
    expect(WorkItemSchema.safeParse(pg203).success).toBe(true);
    expect(TrackerBaseSchema.safeParse(larkspurBase()).success).toBe(true);
  });

  it('accepts a time as HH:mm on a work item, a queue item, a place, a new item and a move', () => {
    expect(
      WorkItemSchema.parse({
        ...pg203,
        plannedFinishTime: '17:00',
        firstPlannedFinishTime: '09:30',
      }),
    ).toMatchObject({ plannedFinishTime: '17:00', firstPlannedFinishTime: '09:30' });
    expect(
      QueueItemInputSchema.parse({
        title: 'X',
        doneBy: 'lan',
        requestedBy: 'minh',
        plannedFinish: '2026-10-20',
        plannedFinishTime: '12:00',
      }).plannedFinishTime,
    ).toBe('12:00');
    expect(
      PlaceArgsSchema.parse({
        itemId: 'q',
        teamId: 't',
        plannedFinish: '2026-10-20',
        plannedFinishTime: '08:15',
      }).plannedFinishTime,
    ).toBe('08:15');
    expect(
      FromEventArgsSchema.parse({
        id: 'w',
        eventId: 'e',
        teamId: 't',
        title: 'X',
        doneBy: 'lan',
        requestedBy: 'minh',
        after: null,
        plannedFinish: '2026-10-20',
        plannedFinishTime: '23:59',
      }).plannedFinishTime,
    ).toBe('23:59');
    expect(DueArgsSchema.parse(dueTo('2026-10-08', '17:00').a).time).toBe('17:00');
    expect(OpSchema.parse(dueTo('2026-10-08', '17:00')).a).toMatchObject({ time: '17:00' });
  });

  it.each(['24:00', '7:00', '17:00:00', '', '17:60'])('refuses the time %j', (time) => {
    expect(WorkItemSchema.safeParse({ ...pg203, plannedFinishTime: time }).success).toBe(false);
    expect(
      OpSchema.safeParse({ ...dueTo('2026-10-08'), a: { ...dueTo('2026-10-08').a, time } }).success,
    ).toBe(false);
  });
});

describe('planned finish time: the instant', () => {
  it('ends a date-only planned finish at the last moment of its day', () => {
    expect(itemDeadline({ plannedFinish: '2026-10-06' }, TIME_ZONE)).toBe(
      Date.parse('2026-10-07T00:00:00+07:00') - 1,
    );
  });

  it('puts a planned finish with a time at that time on the project clock', () => {
    expect(
      itemDeadline({ plannedFinish: '2026-10-06', plannedFinishTime: '17:00' }, TIME_ZONE),
    ).toBe(Date.parse('2026-10-06T17:00:00+07:00'));
  });
});

describe('planned finish time: operations', () => {
  it('due with a time sets it and records both sides of the move', () => {
    const { state, entry } = applyOp(larkspurState(), dueTo('2026-10-08', '17:00'));
    const w = state.workItems.find((x) => x.id === 'pg203')!;
    expect(w).toMatchObject({ plannedFinish: '2026-10-08', plannedFinishTime: '17:00' });
    expect(w.moves.at(-1)).toEqual({
      from: '2026-10-06',
      to: '2026-10-08',
      toTime: '17:00',
      why: WHY,
      by: 'minh',
      at: at('2026-10-08T16:55'),
    });
    expect(entry).toMatchObject({ before: '6 Oct', after: '8 Oct 17:00' });
  });

  it('due without a time drops the old time, and a time-only move is a move', () => {
    const timed = applyOp(larkspurState(), dueTo('2026-10-08', '17:00')).state;
    const later = applyOp(timed, dueTo('2026-10-08', '18:30'));
    const w = later.state.workItems.find((x) => x.id === 'pg203')!;
    expect(w.plannedFinishTime).toBe('18:30');
    expect(w.moves.at(-1)).toMatchObject({ fromTime: '17:00', toTime: '18:30' });
    const plain = applyOp(later.state, dueTo('2026-10-09')).state.workItems.find(
      (x) => x.id === 'pg203',
    )!;
    expect(plain).not.toHaveProperty('plannedFinishTime');
    expect(plain.moves.at(-1)).toMatchObject({ from: '2026-10-08', fromTime: '18:30' });
    expect(plain.moves.at(-1)).not.toHaveProperty('toTime');
  });

  it('shows the time in the review diff lines', () => {
    const d = describeOp(dueTo('2026-10-08', '17:00'), larkspurState(), TIME_ZONE);
    expect(diffLines({ op: 'due', d })).toEqual([
      ['del', 'Planned finish: 6 Oct'],
      ['add', 'Planned finish: 8 Oct 17:00'],
    ]);
  });

  const queued = (over: Partial<QueueItem> = {}): QueueItem => ({
    id: 'q1',
    title: 'Error messages',
    note: '',
    doneBy: 'lan',
    requestedBy: 'minh',
    milestoneId: null,
    after: null,
    plannedFinish: '2026-10-20',
    addedBy: null,
    agent: false,
    createdAt: at('2026-10-08T09:00'),
    ...over,
  });
  const withQueue = (item: QueueItem) => {
    const s = larkspurState();
    s.queue.items = [item];
    return s;
  };
  const placed = (s: ReturnType<typeof larkspurState>, a: Record<string, string>): WorkItem =>
    applyOp(s, makeOp('place', { itemId: 'q1', teamId: 'engineering', ...a })).state.workItems.find(
      (w) => w.id === 'q1',
    )!;

  it('place keeps the time of the queue item, or takes the date and time it is given', () => {
    const s = withQueue(queued({ plannedFinishTime: '12:00' }));
    expect(placed(s, {})).toMatchObject({
      plannedFinish: '2026-10-20',
      plannedFinishTime: '12:00',
      firstPlannedFinishTime: '12:00',
    });
    expect(placed(s, { plannedFinish: '2026-10-21', plannedFinishTime: '09:00' })).toMatchObject({
      plannedFinish: '2026-10-21',
      plannedFinishTime: '09:00',
      firstPlannedFinish: '2026-10-21',
      firstPlannedFinishTime: '09:00',
    });
    const dateOnly = placed(s, { plannedFinish: '2026-10-21' });
    expect(dateOnly).not.toHaveProperty('plannedFinishTime');
    expect(dateOnly).not.toHaveProperty('firstPlannedFinishTime');
  });

  it('fromEvent keeps its time as the first planned time too', () => {
    const s = larkspurState();
    const qe = s.queue.events[0];
    const w = applyOp(
      s,
      makeOp('fromEvent', {
        id: 'new1',
        eventId: qe.id,
        teamId: 'engineering',
        title: 'New',
        doneBy: 'quang',
        requestedBy: 'minh',
        after: null,
        plannedFinish: '2026-10-20',
        plannedFinishTime: '10:00',
      }),
    ).state.workItems.find((x) => x.id === 'new1')!;
    expect(w).toMatchObject({ plannedFinishTime: '10:00', firstPlannedFinishTime: '10:00' });
  });
});

describe('planned finish time: identical changes and clashes', () => {
  const commit = (rev: number, ops: ReturnType<typeof dueTo>[]): Commit => ({
    rev,
    crId: `cr${rev}`,
    crNum: rev,
    mergedBy: 'minh',
    mergedAt: at('2026-10-09T10:00'),
    ops,
    resolutions: [],
  });

  it('treats one date with one time as the same move, and clashes when only the time differs', () => {
    expect(sameOp(dueTo('2026-10-08', '17:00', 0, 'lan'), dueTo('2026-10-08', '17:00'))).toBe(true);
    expect(sameOp(dueTo('2026-10-08', '17:00'), dueTo('2026-10-08'))).toBe(false);
    const commits = [commit(1, [dueTo('2026-10-08', '18:00')])];
    expect(clashesOf([dueTo('2026-10-08', '17:00', 0, 'lan')], commits).map((c) => c.key)).toEqual([
      'loop:pg203:due',
    ]);
    expect(clashesOf([dueTo('2026-10-08', '18:00', 0, 'lan')], commits)).toEqual([]);
  });
});

describe('planned finish time: status and the red line', () => {
  const timed = workItem({ id: 'w', plannedFinish: '2026-10-06', plannedFinishTime: '17:00' });
  const started = event({ id: 's', workItemId: 'w', at: at('2026-10-06T09:00') });
  const done = (local: string) => event({ id: 'd', workItemId: 'w', kind: 'done', at: at(local) });
  const status = (events: ReturnType<typeof event>[], asOf: string) =>
    itemStatus(timed, events, at(asOf), TIME_ZONE);

  it('turns late after the time while open, inside the planned day', () => {
    expect(status([started], '2026-10-06T16:59')).toBe('planned');
    expect(status([started], '2026-10-06T17:01')).toBe('late');
  });

  it('finishes late after the time, on time before it on the day, early on a day before', () => {
    expect(status([started, done('2026-10-06T17:00')], '2026-10-09T18:00')).toBe('ontime');
    expect(status([started, done('2026-10-06T17:30')], '2026-10-09T18:00')).toBe('flate');
    expect(status([started, done('2026-10-05T18:00')], '2026-10-09T18:00')).toBe('early');
  });

  const view: View = {
    hiddenRows: new Set(),
    hiddenTeams: new Set(),
    asOf: AS_OF,
    timeZone: TIME_ZONE,
    windowStart: '2026-10-01',
    windowEnd: '2026-10-11',
  };
  const lines = (w: WorkItem) => {
    const s = buildState({
      teams: [{ id: 'team', name: 'Team', leadId: null }],
      workItems: [w],
      events: [started],
    });
    const L = layoutTracker(s, view);
    return {
      L,
      lines: L.segments.filter(
        (x): x is Extract<LayoutSegment, { kind: 'line' }> => x.kind === 'line',
      ),
    };
  };

  it('starts the red part of the line at the planned finish instant', () => {
    const { L, lines: parts } = lines(timed);
    expect(parts.map((p) => p.tone)).toEqual(['route', 'danger']);
    expect(parts[1].x1).toBeCloseTo(L.x(Date.parse(at('2026-10-06T17:00'))), 6);
  });

  it('starts the red part at the end of the planned day without a time', () => {
    const { L, lines: parts } = lines(workItem({ id: 'w', plannedFinish: '2026-10-06' }));
    expect(parts[1].x1).toBeCloseTo(L.x(Date.parse(at('2026-10-07T00:00')) - 1), 6);
  });
});
