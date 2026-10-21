import { describe, expect, it } from 'vitest';
import { clashesOf, type Commit } from '../../../src/tracker/clash';
import {
  deadlineMs,
  formatDeadline,
  lateBy,
  milestoneDeadline,
} from '../../../src/tracker/deadline';
import { describeOp, diffLines } from '../../../src/tracker/describe';
import { applyOp, sameOp } from '../../../src/tracker/ops';
import {
  FirstMilestoneSchema,
  MilestoneSchema,
  MsDateArgsSchema,
  NewMsArgsSchema,
  OpSchema,
  TrackerBaseSchema,
} from '../../../src/tracker/schemas';
import { milestoneStatus } from '../../../src/tracker/status';
import {
  at,
  buildState,
  event,
  larkspurBase,
  larkspurState,
  makeOp,
  TIME_ZONE,
  workItem,
} from '../../support/tracker-fixture';

const WHY = 'Sarah wants the call before the end of the day.';
const moveTo = (date: string, time?: string, rev = 0, by = 'minh') =>
  makeOp(
    'msDate',
    {
      milestoneId: 'golive',
      date,
      ...(time ? { time } : {}),
      why: WHY,
      by,
      at: at('2026-10-08T16:55'),
    },
    rev,
    by,
  );

describe('milestone deadline time: data', () => {
  const golive = larkspurBase().milestones.find((m) => m.id === 'golive')!;

  it('keeps a stored milestone without a time valid', () => {
    expect(MilestoneSchema.safeParse(golive).success).toBe(true);
    expect(TrackerBaseSchema.safeParse(larkspurBase()).success).toBe(true);
  });

  it('accepts a time as HH:mm on a milestone, a move, a new milestone and a first milestone', () => {
    expect(MilestoneSchema.parse({ ...golive, plannedTime: '17:00' }).plannedTime).toBe('17:00');
    expect(
      MilestoneSchema.parse({
        ...golive,
        firstPlannedTime: '09:30',
        moves: [
          {
            from: '2026-09-30',
            fromTime: '09:30',
            to: '2026-10-15',
            toTime: '17:00',
            why: WHY,
            by: 'minh',
            at: at('2026-10-08T16:55'),
          },
        ],
      }).moves[0],
    ).toMatchObject({ fromTime: '09:30', toTime: '17:00' });
    const move = { milestoneId: 'golive', date: '2026-10-15', why: WHY, by: 'minh' };
    expect(
      MsDateArgsSchema.parse({ ...move, time: '17:00', at: at('2026-10-08T16:55') }).time,
    ).toBe('17:00');
    expect(
      NewMsArgsSchema.parse({
        id: 'ms1',
        name: 'X',
        planned: '2026-10-20',
        time: '00:00',
        members: [],
      }).time,
    ).toBe('00:00');
    expect(
      FirstMilestoneSchema.parse({ name: 'Go-live', date: '2026-10-20', time: '23:59' }),
    ).toEqual({
      name: 'Go-live',
      date: '2026-10-20',
      time: '23:59',
    });
    expect(OpSchema.parse(moveTo('2026-10-15', '17:00')).a).toMatchObject({ time: '17:00' });
  });

  it.each(['24:00', '7:00', '17:00:00', '17h', '', '17:60'])('refuses the time %j', (time) => {
    expect(MilestoneSchema.safeParse({ ...golive, plannedTime: time }).success).toBe(false);
    expect(
      OpSchema.safeParse({ ...moveTo('2026-10-15'), a: { ...moveTo('2026-10-15').a, time } })
        .success,
    ).toBe(false);
  });
});

describe('milestone deadline time: the instant and the label', () => {
  it('ends a date-only deadline at the last moment of its day in the project time zone', () => {
    expect(deadlineMs('2026-10-15', undefined, TIME_ZONE)).toBe(
      Date.parse('2026-10-16T00:00:00+07:00') - 1,
    );
    expect(deadlineMs('2026-10-15', null, 'UTC')).toBe(Date.parse('2026-10-16T00:00:00Z') - 1);
  });

  it('puts a deadline with a time at that time on the project clock', () => {
    expect(deadlineMs('2026-10-15', '17:00', TIME_ZONE)).toBe(
      Date.parse('2026-10-15T17:00:00+07:00'),
    );
    expect(milestoneDeadline({ planned: '2026-10-15', plannedTime: '09:30' }, 'UTC')).toBe(
      Date.parse('2026-10-15T09:30:00Z'),
    );
  });

  it('shows the time only when it is set', () => {
    expect(formatDeadline('2026-10-15')).toBe('15 Oct');
    expect(formatDeadline('2026-10-15', '17:00')).toBe('15 Oct 17:00');
  });
});

describe('milestone deadline time: how late', () => {
  it('counts hours on the day of the deadline and days after it, never 0 days', () => {
    const m = { planned: '2026-10-15', plannedTime: '17:00' };
    expect(lateBy(m, at('2026-10-15T17:20'), TIME_ZONE)).toBe('late 1 h');
    expect(lateBy(m, at('2026-10-15T20:00'), TIME_ZONE)).toBe('late 3 h');
    expect(lateBy(m, at('2026-10-16T09:00'), TIME_ZONE)).toBe('late 1 day');
    expect(lateBy(m, at('2026-10-18T09:00'), TIME_ZONE)).toBe('late 3 days');
    expect(lateBy({ planned: '2026-10-15' }, at('2026-10-17T09:00'), TIME_ZONE)).toBe(
      'late 2 days',
    );
  });
});

describe('milestone deadline time: operations', () => {
  it('msDate with a time sets it and records both sides of the move', () => {
    const { state, entry } = applyOp(larkspurState(), moveTo('2026-10-15', '17:00'));
    const m = state.milestones.find((x) => x.id === 'golive')!;
    expect(m).toMatchObject({ planned: '2026-10-15', plannedTime: '17:00' });
    expect(m.moves.at(-1)).toEqual({
      from: '2026-09-30',
      to: '2026-10-15',
      toTime: '17:00',
      why: WHY,
      by: 'minh',
      at: at('2026-10-08T16:55'),
    });
    expect(entry).toMatchObject({ before: 'planned 30 Sept', after: 'planned 15 Oct 17:00' });
  });

  it('msDate without a time drops the old time, and a time-only move is a move', () => {
    const timed = applyOp(larkspurState(), moveTo('2026-10-15', '17:00')).state;
    const later = applyOp(timed, moveTo('2026-10-15', '18:30'));
    const m = later.state.milestones.find((x) => x.id === 'golive')!;
    expect(m.plannedTime).toBe('18:30');
    expect(m.moves.at(-1)).toMatchObject({ fromTime: '17:00', toTime: '18:30' });
    expect(later.entry).toMatchObject({
      before: 'planned 15 Oct 17:00',
      after: 'planned 15 Oct 18:30',
    });
    const plain = applyOp(later.state, moveTo('2026-10-16')).state.milestones.find(
      (x) => x.id === 'golive',
    )!;
    expect(plain).not.toHaveProperty('plannedTime');
    expect(plain.moves.at(-1)).toEqual({
      from: '2026-10-15',
      fromTime: '18:30',
      to: '2026-10-16',
      why: WHY,
      by: 'minh',
      at: at('2026-10-08T16:55'),
    });
    expect(JSON.parse(JSON.stringify(plain))).toEqual(plain);
  });

  it('newMs with a time keeps it as the first planned time too', () => {
    const op = makeOp('newMs', {
      id: 'ms1',
      name: 'Investor call',
      planned: '2026-10-20',
      time: '09:30',
      members: ['pg201'],
    });
    const { state, entry } = applyOp(larkspurState(), op);
    expect(state.milestones.at(-1)).toEqual({
      id: 'ms1',
      name: 'Investor call',
      planned: '2026-10-20',
      plannedTime: '09:30',
      firstPlanned: '2026-10-20',
      firstPlannedTime: '09:30',
      moves: [],
    });
    expect(entry.after).toBe('planned 20 Oct 09:30, 1 work item');
    expect(diffLines({ op: 'newMs', d: entry })).toEqual([
      ['add', 'New milestone: 20 Oct 09:30, 1 work item'],
    ]);
  });

  it('shows the time in the review diff lines', () => {
    const d = describeOp(moveTo('2026-10-15', '17:00'), larkspurState(), TIME_ZONE);
    expect(diffLines({ op: 'msDate', d })).toEqual([
      ['del', 'Planned date: 30 Sept'],
      ['add', 'Planned date: 15 Oct 17:00'],
    ]);
  });
});

describe('milestone deadline time: identical changes and clashes', () => {
  const commit = (rev: number, ops: ReturnType<typeof moveTo>[]): Commit => ({
    rev,
    crId: `cr${rev}`,
    crNum: rev,
    mergedBy: 'minh',
    mergedAt: at('2026-10-09T10:00'),
    ops,
    resolutions: [],
  });

  it('treats one date with one time as the same move, whoever made it', () => {
    expect(sameOp(moveTo('2026-10-15', '17:00', 0, 'lan'), moveTo('2026-10-15', '17:00'))).toBe(
      true,
    );
    expect(sameOp(moveTo('2026-10-15'), moveTo('2026-10-15'))).toBe(true);
  });

  it('clashes on the date spot when only the time differs', () => {
    expect(sameOp(moveTo('2026-10-15', '17:00'), moveTo('2026-10-15'))).toBe(false);
    expect(sameOp(moveTo('2026-10-15', '17:00'), moveTo('2026-10-15', '18:00'))).toBe(false);
    const commits = [commit(1, [moveTo('2026-10-15', '18:00')])];
    expect(clashesOf([moveTo('2026-10-15', '17:00', 0, 'lan')], commits).map((c) => c.key)).toEqual(
      ['ms:golive:date'],
    );
    expect(clashesOf([moveTo('2026-10-15', '18:00', 0, 'lan')], commits)).toEqual([]);
  });
});

describe('milestone deadline time: status', () => {
  const state = (plannedTime: string | undefined, finish: string | null) =>
    buildState({
      milestones: [
        {
          id: 'm',
          name: 'M',
          planned: '2026-10-15',
          ...(plannedTime ? { plannedTime } : {}),
          firstPlanned: '2026-10-15',
          moves: [],
        },
      ],
      workItems: [workItem({ id: 'a', milestoneId: 'm' })],
      events: finish ? [event({ id: 'd', workItemId: 'a', kind: 'done', at: at(finish) })] : [],
    });
  const status = (time: string | undefined, finish: string | null, asOf = '2026-10-15T12:00') => {
    const s = state(time, finish);
    return milestoneStatus(s.milestones[0], s.workItems, s.events, at(asOf), TIME_ZONE).status;
  };

  it('finishes late after the time of the deadline, inside the same day', () => {
    expect(status('17:00', '2026-10-15T16:59')).toBe('ontime');
    expect(status('17:00', '2026-10-15T17:00')).toBe('ontime');
    expect(status('17:00', '2026-10-15T17:30')).toBe('flate');
    expect(status('17:00', '2026-10-14T18:00')).toBe('early');
  });

  it('turns late after the time of the deadline while open', () => {
    expect(status('17:00', null, '2026-10-15T16:00')).toBe('planned');
    expect(status('17:00', null, '2026-10-15T17:01')).toBe('late');
  });

  it('keeps the whole day for a deadline without a time', () => {
    expect(status(undefined, '2026-10-15T23:30')).toBe('ontime');
    expect(status(undefined, '2026-10-16T00:00')).toBe('flate');
    expect(status(undefined, null, '2026-10-15T23:59')).toBe('planned');
    expect(status(undefined, null, '2026-10-16T00:00')).toBe('late');
  });
});
