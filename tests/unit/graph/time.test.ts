import { describe, expect, it } from 'vitest';
import { zonedInstant } from '../../../src/lib/calendar';

describe('zonedInstant (Evaluate-at input)', () => {
  it('reads a wall time in the project time zone', () => {
    expect(zonedInstant('2026-10-09', '18:00', 'Asia/Ho_Chi_Minh')).toBe('2026-10-09T11:00:00.000Z');
  });
  it('uses the offset in force at that wall time, not at midnight', () => {
    expect(zonedInstant('2026-03-08', '03:30', 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
    expect(zonedInstant('2026-11-01', '12:00', 'America/New_York')).toBe('2026-11-01T17:00:00.000Z');
  });
  it('rejects a malformed time', () => {
    expect(() => zonedInstant('2026-10-09', '25:00', 'Asia/Ho_Chi_Minh')).toThrow(RangeError);
    expect(() => zonedInstant('2026-10-09', '9:00', 'Asia/Ho_Chi_Minh')).toThrow(RangeError);
  });
});
