import { describe, expect, it } from 'vitest';
import { wallTimeInstant } from '../../../src/tracker/time';

describe('wallTimeInstant: a wall time in a time zone', () => {
  it('keeps the wall time in a zone without daylight saving', () => {
    expect(wallTimeInstant('2026-10-09', '17:00', 'Asia/Ho_Chi_Minh')).toBe(
      '2026-10-09T17:00:00+07:00',
    );
  });

  it('uses the offset of that hour on a daylight saving day', () => {
    expect(wallTimeInstant('2026-03-08', '10:00', 'America/New_York')).toBe(
      '2026-03-08T10:00:00-04:00',
    );
    expect(wallTimeInstant('2026-11-01', '10:00', 'America/New_York')).toBe(
      '2026-11-01T10:00:00-05:00',
    );
    expect(wallTimeInstant('2026-03-29', '01:30', 'Europe/Berlin')).toBe(
      '2026-03-29T01:30:00+01:00',
    );
    expect(wallTimeInstant('2026-03-29', '10:00', 'Europe/Berlin')).toBe(
      '2026-03-29T10:00:00+02:00',
    );
  });

  it('moves a wall time that the clock skips to the hour after', () => {
    expect(wallTimeInstant('2026-03-08', '02:30', 'America/New_York')).toBe(
      '2026-03-08T03:30:00-04:00',
    );
  });
});
