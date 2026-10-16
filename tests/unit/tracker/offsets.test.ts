import { describe, expect, it } from 'vitest';
import {
  clampOffset,
  drawnAt,
  findEventAt,
  offsetFor,
  offsetRange,
} from '../../../src/tracker/offsets';
import {
  at,
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
