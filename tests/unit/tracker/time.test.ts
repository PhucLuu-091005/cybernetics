import { describe, expect, it } from 'vitest';
import { dayOf, startOfDayInstant, wallTimeInstant } from '../../../src/tracker/time';

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

  it('moves a wall time that the clock skips to after the gap, west and east of UTC', () => {
    expect(wallTimeInstant('2026-03-08', '02:30', 'America/New_York')).toBe(
      '2026-03-08T03:30:00-04:00',
    );
    expect(wallTimeInstant('2026-03-29', '02:30', 'Europe/Berlin')).toBe(
      '2026-03-29T03:30:00+02:00',
    );
    expect(wallTimeInstant('2026-03-29', '01:30', 'Europe/London')).toBe(
      '2026-03-29T02:30:00+01:00',
    );
    expect(wallTimeInstant('2026-10-04', '02:15', 'Australia/Lord_Howe')).toBe(
      '2026-10-04T02:45:00+11:00',
    );
  });
});

describe('startOfDayInstant: the first moment of a day', () => {
  it('starts a day whose midnight the clock skips at the end of the gap', () => {
    expect(startOfDayInstant('2026-09-06', 'America/Santiago')).toBe('2026-09-06T01:00:00-03:00');
    expect(dayOf(startOfDayInstant('2026-09-06', 'America/Santiago'), 'America/Santiago')).toBe(
      '2026-09-06',
    );
  });

  it('keeps midnight on the days around it and in other zones', () => {
    expect(startOfDayInstant('2026-09-05', 'America/Santiago')).toBe('2026-09-05T00:00:00-04:00');
    expect(startOfDayInstant('2026-09-07', 'America/Santiago')).toBe('2026-09-07T00:00:00-03:00');
    expect(startOfDayInstant('2026-03-29', 'Europe/Berlin')).toBe('2026-03-29T00:00:00+01:00');
    expect(startOfDayInstant('2026-10-04', 'Australia/Lord_Howe')).toBe(
      '2026-10-04T00:00:00+10:30',
    );
  });
});
