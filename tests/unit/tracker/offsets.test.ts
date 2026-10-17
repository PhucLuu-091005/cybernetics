import { describe, expect, it } from 'vitest';
import {
  clampDrag,
  clampOffset,
  drawnAt,
  drawnTimes,
  findEventAt,
  offsetFor,
  offsetRange,
} from '../../../src/tracker/offsets';
import {
  at,
  event,
  larkspurBase,
  larkspurQueueRows,
  makeOp,
  TIME_ZONE,
} from '../../support/tracker-fixture';

const MINUTE = 60_000;

describe('offsetRange: the minutes an event can move inside its own day', () => {
  it('reaches from midnight to 23:59 on the project clock', () => {
    expect(offsetRange(at('2026-09-24T09:20'), TIME_ZONE)).toEqual({ min: -560, max: 879 });
    expect(offsetRange(at('2026-09-24T00:00'), TIME_ZONE)).toEqual({ min: 0, max: 1439 });
    expect(offsetRange(at('2026-09-24T23:59'), TIME_ZONE)).toEqual({ min: -1439, max: 0 });
  });

  it('keeps an event with seconds inside the day at both ends', () => {
    const instant = '2026-09-24T09:20:30+07:00';
    const { min, max } = offsetRange(instant, TIME_ZONE);
    expect({ min, max }).toEqual({ min: -560, max: 879 });
    const start = Date.parse('2026-09-24T00:00:00+07:00');
    const next = Date.parse('2026-09-25T00:00:00+07:00');
    expect(Date.parse(instant) + min * MINUTE).toBeGreaterThanOrEqual(start);
    expect(Date.parse(instant) + max * MINUTE).toBeLessThan(next);
  });

  it('uses the day of the project time zone, not the day in UTC', () => {
    expect(offsetRange('2026-09-24T01:00:00Z', 'Asia/Ho_Chi_Minh')).toEqual({
      min: -480,
      max: 959,
    });
    expect(offsetRange('2026-09-24T01:00:00Z', 'UTC')).toEqual({ min: -60, max: 1379 });
  });

  it('follows a 23-hour day across a daylight saving change', () => {
    expect(offsetRange('2026-03-08T12:00:00-04:00', 'America/New_York')).toEqual({
      min: -660,
      max: 719,
    });
  });
});

describe('clampOffset', () => {
  const nineTwenty = at('2026-09-24T09:20');

  it('keeps an offset inside the day', () => {
    expect(clampOffset(nineTwenty, 120, TIME_ZONE)).toBe(120);
    expect(clampOffset(nineTwenty, -560, TIME_ZONE)).toBe(-560);
    expect(clampOffset(nineTwenty, 879, TIME_ZONE)).toBe(879);
  });

  it('stops an offset at the start and the end of the day', () => {
    expect(clampOffset(nineTwenty, -900, TIME_ZONE)).toBe(-560);
    expect(clampOffset(nineTwenty, 2000, TIME_ZONE)).toBe(879);
  });

  it('rounds to whole minutes and reads a missing or broken offset as 0', () => {
    expect(clampOffset(nineTwenty, 12.6, TIME_ZONE)).toBe(13);
    expect(clampOffset(nineTwenty, undefined, TIME_ZONE)).toBe(0);
    expect(clampOffset(nineTwenty, Number.NaN, TIME_ZONE)).toBe(0);
    expect(Object.is(clampOffset(at('2026-09-24T00:00'), -0.4, TIME_ZONE), 0)).toBe(true);
  });
});

describe('drawnAt and offsetFor', () => {
  const ev = { id: 'p31', at: at('2026-09-24T09:20') };

  it('draws an event at its time plus its offset, clamped to its day', () => {
    expect(drawnAt(ev, {}, TIME_ZONE)).toBe(Date.parse(ev.at));
    expect(drawnAt(ev, { p31: 100 }, TIME_ZONE)).toBe(Date.parse(ev.at) + 100 * MINUTE);
    expect(drawnAt(ev, { p31: 5000 }, TIME_ZONE)).toBe(Date.parse(at('2026-09-24T23:59')));
    expect(drawnAt(ev, { other: 100 }, TIME_ZONE)).toBe(Date.parse(ev.at));
  });

  it('turns a dragged time into the offset of the drop, inside the day', () => {
    expect(offsetFor(ev.at, Date.parse(at('2026-09-24T11:00')), TIME_ZONE)).toBe(100);
    expect(offsetFor(ev.at, Date.parse(at('2026-09-23T20:00')), TIME_ZONE)).toBe(-560);
    expect(offsetFor(ev.at, Date.parse(at('2026-09-25T03:00')), TIME_ZONE)).toBe(879);
  });
});

describe('findEventAt: the time of an event in any view of the project', () => {
  const base = larkspurBase();
  const queue = larkspurQueueRows();

  it('finds an event of the base graph', () => {
    expect(findEventAt('p31', base, queue, [])).toBe(base.events.find((e) => e.id === 'p31')!.at);
  });

  it('finds a queue event, which a change request can attach', () => {
    const card = queue.find((row) => row.kind === 'event')!;
    expect(card.kind === 'event' && findEventAt(card.id, base, queue, [])).toBe(
      card.kind === 'event' && card.payload.at,
    );
  });

  it('finds an event that a change request adds', () => {
    const added = makeOp('addEvent', {
      workItemId: 'pg203',
      ev: { id: 'new1', kind: 'message', at: at('2026-10-02T08:00'), by: 'lan', text: 'Hi' },
    });
    expect(findEventAt('new1', base, queue, [[], [added]])).toBe(at('2026-10-02T08:00'));
  });

  it('answers null for an unknown event', () => {
    expect(findEventAt('nope', base, queue, [])).toBeNull();
  });
});

describe('drawnTimes: the time order of one row and day survives any saved offset', () => {
  const day = [
    event({ id: 'a', workItemId: 'w', at: at('2026-09-24T09:00') }),
    event({ id: 'b', workItemId: 'w', at: at('2026-09-24T12:00') }),
    event({ id: 'c', workItemId: 'w', at: at('2026-09-24T15:00') }),
    event({ id: 'other', workItemId: 'x', at: at('2026-09-24T10:00') }),
    event({ id: 'next', workItemId: 'w', at: at('2026-09-25T08:00') }),
  ];

  it('draws each event at its time plus its offset while the order holds', () => {
    const drawn = drawnTimes(day, { a: 60, c: -60 }, TIME_ZONE);
    expect(drawn.get('a')).toBe(Date.parse(at('2026-09-24T10:00')));
    expect(drawn.get('b')).toBe(Date.parse(at('2026-09-24T12:00')));
    expect(drawn.get('c')).toBe(Date.parse(at('2026-09-24T14:00')));
  });

  it('never draws a later event left of an earlier one on the same row and day', () => {
    const drawn = drawnTimes(day, { a: 600, c: -480 }, TIME_ZONE);
    expect(drawn.get('a')).toBe(Date.parse(at('2026-09-24T19:00')));
    expect(drawn.get('b')).toBe(Date.parse(at('2026-09-24T19:00')));
    expect(drawn.get('c')).toBe(Date.parse(at('2026-09-24T19:00')));
  });

  it('leaves other rows and other days alone', () => {
    const drawn = drawnTimes(day, { a: 600, other: -300 }, TIME_ZONE);
    expect(drawn.get('other')).toBe(Date.parse(at('2026-09-24T05:00')));
    expect(drawn.get('next')).toBe(Date.parse(at('2026-09-25T08:00')));
  });

  it('orders events with the same time by id', () => {
    const same = [
      event({ id: 'y', workItemId: 'w', at: at('2026-09-24T09:00') }),
      event({ id: 'x', workItemId: 'w', at: at('2026-09-24T09:00') }),
    ];
    const drawn = drawnTimes(same, { x: 30 }, TIME_ZONE);
    expect(drawn.get('y')).toBe(Date.parse(at('2026-09-24T09:30')));
  });
});

describe('clampDrag: a sideways drag stops at the events before and after', () => {
  const day = [
    event({ id: 'a', workItemId: 'w', at: at('2026-09-24T09:00') }),
    event({ id: 'b', workItemId: 'w', at: at('2026-09-24T12:00') }),
    event({ id: 'c', workItemId: 'w', at: at('2026-09-24T15:00') }),
    event({ id: 'other', workItemId: 'x', at: at('2026-09-24T13:00') }),
  ];
  const b = day[1];

  it('keeps a move that stays between its neighbours', () => {
    expect(clampDrag(b, 60, day, {}, TIME_ZONE)).toBe(60);
    expect(clampDrag(b, -60, day, {}, TIME_ZONE)).toBe(-60);
  });

  it('stops at the drawn position of the next and the previous event', () => {
    expect(clampDrag(b, 300, day, {}, TIME_ZONE)).toBe(180);
    expect(clampDrag(b, -300, day, {}, TIME_ZONE)).toBe(-180);
    expect(clampDrag(b, 300, day, { c: 60 }, TIME_ZONE)).toBe(240);
    expect(clampDrag(b, -300, day, { a: 120 }, TIME_ZONE)).toBe(-60);
  });

  it('lets the first and the last event reach the ends of the day', () => {
    expect(clampDrag(day[0], -5000, day, {}, TIME_ZONE)).toBe(-540);
    expect(clampDrag(day[2], 5000, day, {}, TIME_ZONE)).toBe(539);
  });

  it('ignores events of other rows and other days', () => {
    const more = [...day, event({ id: 'd', workItemId: 'w', at: at('2026-09-25T01:00') })];
    expect(clampDrag(day[2], 5000, more, {}, TIME_ZONE)).toBe(539);
    expect(clampDrag(b, 120, more, { other: -600 }, TIME_ZONE)).toBe(120);
  });

  it('keeps two events with the same time in id order', () => {
    const same = [
      event({ id: 'x', workItemId: 'w', at: at('2026-09-24T09:00') }),
      event({ id: 'y', workItemId: 'w', at: at('2026-09-24T09:00') }),
    ];
    expect(clampDrag(same[0], 30, same, {}, TIME_ZONE)).toBe(0);
    expect(clampDrag(same[1], -30, same, {}, TIME_ZONE)).toBe(0);
    expect(clampDrag(same[1], 30, same, {}, TIME_ZONE)).toBe(30);
  });

  it('rounds to whole minutes inside the room that seconds leave', () => {
    const near = [
      event({ id: 'a', workItemId: 'w', at: '2026-09-24T09:00:40+07:00' }),
      event({ id: 'b', workItemId: 'w', at: '2026-09-24T09:01:20+07:00' }),
      event({ id: 'c', workItemId: 'w', at: '2026-09-24T09:02:30+07:00' }),
    ];
    expect(clampDrag(near[1], 5, near, {}, TIME_ZONE)).toBe(1);
    expect(clampDrag(near[1], -5, near, {}, TIME_ZONE)).toBe(0);
  });

  it('takes the side of the earlier event when no whole minute fits between the two', () => {
    const tight = [
      event({ id: 'a', workItemId: 'w', at: '2026-09-24T09:00:00+07:00' }),
      event({ id: 'b', workItemId: 'w', at: '2026-09-24T09:00:30+07:00' }),
      event({ id: 'c', workItemId: 'w', at: '2026-09-24T09:01:20+07:00' }),
    ];
    expect(clampDrag(tight[1], 5, tight, { a: 1 }, TIME_ZONE)).toBe(1);
    expect(clampDrag(tight[1], -5, tight, { a: 1 }, TIME_ZONE)).toBe(1);
  });

  it('measures the next event at its normalised position', () => {
    expect(clampDrag(day[0], 600, day, { b: -300 }, TIME_ZONE)).toBe(0);
  });
});
