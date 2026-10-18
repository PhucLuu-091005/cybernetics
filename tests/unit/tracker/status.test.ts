import { describe, expect, it } from 'vitest';
import type { Milestone, TrackerEvent } from '../../../src/tracker/model';
import { itemInfo, itemStatus, milestoneStatus } from '../../../src/tracker/status';
import {
  addDays,
  compareDay,
  dayOf,
  formatDay,
  formatStamp,
  startOfDayInstant,
} from '../../../src/tracker/time';
import {
  AS_OF,
  TIME_ZONE,
  at,
  event,
  larkspurState,
  workItem,
} from '../../support/tracker-fixture';

const item = workItem({ id: 'w', plannedFinish: '2026-10-06' });
const started = event({ id: 'e0', workItemId: 'w', kind: 'task', at: at('2026-10-01T09:00') });
const doneAt = (instant: string, id = 'e1'): TrackerEvent =>
  event({ id, workItemId: 'w', kind: 'done', at: instant });

describe('itemInfo', () => {
  it('reads done, finish, start and end from the visible events', () => {
    const events = [doneAt(at('2026-10-05T10:00')), started];
    expect(itemInfo(item, events)).toMatchObject({
      done: true,
      finishedAt: at('2026-10-05T10:00'),
      start: at('2026-10-01T09:00'),
      end: at('2026-10-05T10:00'),
    });
  });

  it('ends at asOf while open and ignores other items and hidden events', () => {
    const other = event({ id: 'o', workItemId: 'other', kind: 'done', at: at('2026-09-01T09:00') });
    const hidden = { ...doneAt(at('2026-10-02T09:00')), hidden: true };
    expect(itemInfo(item, [started, other, hidden], AS_OF)).toMatchObject({
      done: false,
      finishedAt: null,
      start: at('2026-10-01T09:00'),
      end: AS_OF,
    });
    expect(itemInfo(item, [])).toMatchObject({ done: false, start: null, end: null });
  });

  it('takes the last visible Done event as the finish', () => {
    const events = [
      doneAt(at('2026-10-08T10:00'), 'late'),
      doneAt(at('2026-10-05T10:00'), 'early'),
    ];
    expect(itemInfo(item, events).finishedAt).toBe(at('2026-10-08T10:00'));
  });
});

describe('itemStatus', () => {
  const status = (events: TrackerEvent[], asOf = at('2026-10-09T18:00')) =>
    itemStatus(item, events, asOf, TIME_ZONE);

  it('is planned while open on or before the planned day', () => {
    expect(status([started], at('2026-10-06T23:59'))).toBe('planned');
  });

  it('is late while open after the planned day', () => {
    expect(status([started], at('2026-10-07T00:00'))).toBe('late');
  });

  it('is finished early, on time or late by the day of the finish', () => {
    expect(status([started, doneAt(at('2026-10-05T23:59'))])).toBe('early');
    expect(status([started, doneAt(at('2026-10-06T08:00'))])).toBe('ontime');
    expect(status([started, doneAt(at('2026-10-07T00:00'))])).toBe('flate');
  });

  it('ignores a hidden Done event', () => {
    expect(status([started, { ...doneAt(at('2026-10-05T10:00')), hidden: true }])).toBe('late');
  });

  it('compares calendar days in the project time zone, not UTC', () => {
    expect(status([doneAt('2026-10-06T23:30:00+07:00')])).toBe('ontime');
    expect(status([doneAt('2026-10-06T17:30:00Z')])).toBe('flate');
    expect(status([doneAt('2026-10-05T18:30:00Z')])).toBe('ontime');
    expect(status([started], '2026-10-06T16:59:00Z')).toBe('planned');
    expect(status([started], '2026-10-06T17:30:00Z')).toBe('late');
  });
});

describe('milestoneStatus', () => {
  const ms: Milestone = {
    id: 'm',
    name: 'M',
    planned: '2026-10-06',
    firstPlanned: '2026-10-06',
    moves: [],
  };
  const a = workItem({ id: 'a', milestoneId: 'm' });
  const b = workItem({ id: 'b', milestoneId: 'm' });
  const loose = workItem({ id: 'c' });
  const items = [a, b, loose];
  const done = (id: string, instant: string) =>
    event({ id: `${id}-done`, workItemId: id, kind: 'done', at: instant });
  const status = (events: TrackerEvent[], asOf = at('2026-10-09T18:00')) =>
    milestoneStatus(ms, items, events, asOf, TIME_ZONE);

  it('is done when all members are done, at the latest finish', () => {
    const r = status([done('a', at('2026-10-02T10:00')), done('b', at('2026-10-04T10:00'))]);
    expect(r).toEqual({ status: 'early', finishedAt: at('2026-10-04T10:00'), members: [a, b] });
    expect(
      status([done('a', at('2026-10-02T10:00')), done('b', at('2026-10-06T22:00'))]).status,
    ).toBe('ontime');
    expect(
      status([done('a', at('2026-10-08T10:00')), done('b', at('2026-10-04T10:00'))]).status,
    ).toBe('flate');
  });

  it('is late or planned while a member is open', () => {
    const events = [done('a', at('2026-10-02T10:00'))];
    expect(status(events)).toEqual({ status: 'late', finishedAt: null, members: [a, b] });
    expect(status(events, at('2026-10-06T23:00')).status).toBe('planned');
  });

  it('compares the finish day in the project time zone', () => {
    const events = [done('a', at('2026-10-02T10:00')), done('b', '2026-10-06T17:30:00Z')];
    expect(status(events).status).toBe('flate');
  });

  it('with no members is planned or late by date', () => {
    const empty = (asOf: string) => milestoneStatus(ms, [loose], [], asOf, TIME_ZONE);
    expect(empty(at('2026-10-06T12:00'))).toEqual({
      status: 'planned',
      finishedAt: null,
      members: [],
    });
    expect(empty(at('2026-10-07T00:10')).status).toBe('late');
  });
});

describe('Larkspur statuses at the demo time', () => {
  const s = larkspurState();
  const byId = (id: string) => s.workItems.find((w) => w.id === id)!;

  it.each([
    ['pg203', 'late'],
    ['pg202', 'flate'],
    ['pg201', 'ontime'],
    ['rehearsal', 'early'],
    ['test', 'planned'],
    ['legal', 'ontime'],
  ])('%s is %s', (id, expected) => {
    expect(itemStatus(byId(id), s.events, AS_OF, TIME_ZONE)).toBe(expected);
  });

  it('both milestones are late', () => {
    for (const m of s.milestones) {
      expect(milestoneStatus(m, s.workItems, s.events, AS_OF, TIME_ZONE).status).toBe('late');
    }
  });
});

describe('time', () => {
  it('dayOf gives the calendar day in the time zone', () => {
    expect(dayOf('2026-10-06T17:30:00Z', TIME_ZONE)).toBe('2026-10-07');
    expect(dayOf('2026-10-06T17:30:00Z', 'UTC')).toBe('2026-10-06');
    expect(dayOf('2026-10-07T00:30:00+07:00', 'America/New_York')).toBe('2026-10-06');
  });

  it('addDays crosses months and years', () => {
    expect(addDays('2026-09-28', 7)).toBe('2026-10-05');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('compareDay orders dates', () => {
    expect(compareDay('2026-10-06', '2026-10-07')).toBeLessThan(0);
    expect(compareDay('2026-10-07', '2026-10-06')).toBeGreaterThan(0);
    expect(compareDay('2026-10-06', '2026-10-06')).toBe(0);
  });

  it('startOfDayInstant gives midnight with the zone offset', () => {
    expect(startOfDayInstant('2026-10-06', TIME_ZONE)).toBe('2026-10-06T00:00:00+07:00');
    expect(startOfDayInstant('2026-01-15', 'America/New_York')).toBe('2026-01-15T00:00:00-05:00');
    expect(startOfDayInstant('2026-07-15', 'America/New_York')).toBe('2026-07-15T00:00:00-04:00');
    expect(startOfDayInstant('2026-07-15', 'UTC')).toBe('2026-07-15T00:00:00+00:00');
  });

  it('formats days and stamps like the prototype', () => {
    expect(formatDay('2026-09-25')).toBe('25 Sept');
    expect(formatDay('2026-01-05')).toBe('5 Jan');
    expect(formatStamp('2026-10-09T11:00:00Z', TIME_ZONE)).toBe('9 Oct 18:00');
    expect(formatStamp('2026-10-09T18:00:00+07:00', 'UTC')).toBe('9 Oct 11:00');
    expect(formatStamp('2026-10-08T17:05:00Z', TIME_ZONE)).toBe('9 Oct 00:05');
  });
});
