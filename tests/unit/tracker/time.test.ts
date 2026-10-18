import { describe, expect, it } from 'vitest';
import {
  addMonths,
  completeDayText,
  completeTimeText,
  dayOf,
  formatDayYear,
  formatMonth,
  monthGrid,
  parseDayText,
  parseTimeText,
  startOfDayInstant,
  timeSteps,
  wallTimeInstant,
} from '../../../src/tracker/time';

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

describe('formatDayYear and parseDayText: the app date format in a text box', () => {
  it('writes a day with its year', () => {
    expect(formatDayYear('2026-10-06')).toBe('6 Oct 2026');
    expect(formatDayYear('2027-09-30')).toBe('30 Sept 2027');
  });

  it('reads the app format, a short or long month name, any case, and an ISO day', () => {
    expect(parseDayText('6 Oct 2026', 2026)).toBe('2026-10-06');
    expect(parseDayText('  30 sept 2027 ', 2026)).toBe('2027-09-30');
    expect(parseDayText('30 Sep 2027', 2026)).toBe('2027-09-30');
    expect(parseDayText('1 January 2027', 2026)).toBe('2027-01-01');
    expect(parseDayText('2026-10-10', 2020)).toBe('2026-10-10');
  });

  it('takes the given year when the text has none', () => {
    expect(parseDayText('12 Nov', 2026)).toBe('2026-11-12');
  });

  it('refuses a day that does not exist and text that is not a day', () => {
    for (const text of [
      '31 Sept 2026',
      '29 Feb 2026',
      '2026-02-30',
      '',
      'soon',
      '6 Octo 2026',
      '6 Oct 26',
    ])
      expect(parseDayText(text, 2026)).toBeNull();
    expect(parseDayText('29 Feb 2028', 2026)).toBe('2028-02-29');
  });
});

describe('parseTimeText: the app time format (24 hours, "14:30") in a text box', () => {
  it('reads hours and minutes with or without a colon', () => {
    expect(parseTimeText('14:30')).toBe('14:30');
    expect(parseTimeText('1430')).toBe('14:30');
    expect(parseTimeText(' 930 ')).toBe('09:30');
    expect(parseTimeText('09:05')).toBe('09:05');
    expect(parseTimeText('0:00')).toBe('00:00');
    expect(parseTimeText('23:59')).toBe('23:59');
    expect(parseTimeText('14.30')).toBe('14:30');
  });

  it('reads a lone hour as the full hour and one minute digit as that minute', () => {
    expect(parseTimeText('9')).toBe('09:00');
    expect(parseTimeText('17')).toBe('17:00');
    expect(parseTimeText('9:5')).toBe('09:05');
    expect(parseTimeText('9:')).toBe('09:00');
  });

  it('refuses text that is not a time of the day', () => {
    for (const text of ['', ' ', '24:00', '25', '9:60', '12345', 'noon', '2pm', '-1', '1:2:3'])
      expect(parseTimeText(text)).toBeNull();
  });
});

describe('timeSteps: the times in the list of a time box', () => {
  it('lists a whole day in 30-minute steps', () => {
    const steps = timeSteps();
    expect(steps).toHaveLength(48);
    expect(steps.slice(0, 3)).toEqual(['00:00', '00:30', '01:00']);
    expect(steps.at(-1)).toBe('23:30');
  });
});

describe('the calendar of a date box', () => {
  it('names the month of a day in full', () => {
    expect(formatMonth('2026-10-06')).toBe('October 2026');
    expect(formatMonth('2027-09-30')).toBe('September 2027');
  });

  it('moves by months and keeps the day inside the shorter month', () => {
    expect(addMonths('2026-10-06', 1)).toBe('2026-11-06');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-03-31', -1)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('lays out 6 weeks from Monday that hold the whole month', () => {
    const weeks = monthGrid('2026-10-06');
    expect(weeks).toHaveLength(6);
    for (const week of weeks) expect(week).toHaveLength(7);
    expect(weeks[0][0]).toBe('2026-09-28');
    expect(weeks[0][3]).toBe('2026-10-01');
    expect(weeks.flat()).toContain('2026-10-31');
    expect(weeks[5][6]).toBe('2026-11-08');
  });

  it('starts on the 1st when the month starts on a Monday', () => {
    expect(monthGrid('2026-06-20')[0][0]).toBe('2026-06-01');
  });
});

describe('parseDayText: years the app cannot hold', () => {
  it('refuses a year before 1000 instead of throwing', () => {
    for (const text of ['6 Oct 0202', '0099-01-01', '1 Jan 0001', '0000-01-01'])
      expect(parseDayText(text, 2026)).toBeNull();
    expect(parseDayText('6 Oct 1000', 2026)).toBe('1000-10-06');
  });
});

describe('completeDayText and completeTimeText: what a box saves while the person types', () => {
  it('saves a day only once its text is whole: a 4-digit year or a full ISO day', () => {
    expect(completeDayText('6 Oct 2026')).toBe('2026-10-06');
    expect(completeDayText('2026-10-20')).toBe('2026-10-20');
    for (const text of ['6', '6 Oct', '6 Oct 2', '6 Oct 202', '2026-10-2', '31 Sept 2026'])
      expect(completeDayText(text)).toBeNull();
  });

  it('saves a time only once its text is whole: two minute digits', () => {
    expect(completeTimeText('14:30')).toBe('14:30');
    expect(completeTimeText('9:05')).toBe('09:05');
    expect(completeTimeText('1430')).toBe('14:30');
    for (const text of ['2', '25', '25:0', '25:00', '9:7', '9:75', '143', '9:5', '9', ''])
      expect(completeTimeText(text)).toBeNull();
  });
});
