import { describe, expect, it } from 'vitest';
import { findEventAt, offsetRange } from '../../../src/tracker/offsets';
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
