export const DEFAULT_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
] as const;

type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoned(ms: number, timeZone: string): Parts {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, format);
  }
  const parts: Record<string, number> = {};
  for (const part of format.formatToParts(ms)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts as Parts;
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0');

const isoDate = (p: Pick<Parts, 'year' | 'month' | 'day'>) =>
  `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;

function parseDay(date: string): [number, number, number] {
  const [year, month, day] = date.split('-').map(Number);
  return [year, month, day];
}

function offsetMs(ms: number, timeZone: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  const p = zoned(whole, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
}

export function dayOf(instant: string, timeZone: string): string {
  return isoDate(zoned(Date.parse(instant), timeZone));
}

export function addDays(date: string, n: number): string {
  const [year, month, day] = parseDay(date);
  return new Date(Date.UTC(year, month - 1, day + n)).toISOString().slice(0, 10);
}

export function compareDay(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function toInstant(ms: number, timeZone: string): string {
  const p = zoned(ms, timeZone);
  const offset = Math.round(offsetMs(ms, timeZone) / 60000);
  const sign = offset < 0 ? '-' : '+';
  const zone = `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
  return `${isoDate(p)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${zone}`;
}

/** A zone that skips its midnight (America/Santiago) starts the day at the end of the gap. */
export function startOfDayInstant(date: string, timeZone: string): string {
  const [year, month, day] = parseDay(date);
  const midnightUtc = Date.UTC(year, month - 1, day);
  const first = offsetMs(midnightUtc, timeZone);
  const second = offsetMs(midnightUtc - first, timeZone);
  const inDay = [midnightUtc - first, midnightUtc - second].filter(
    (ms) => isoDate(zoned(ms, timeZone)) === date,
  );
  return toInstant(Math.min(...inDay), timeZone);
}

/** `time` is `HH:mm` on the clock of `timeZone`; a time that the clock skips resolves to after the gap. */
export function wallTimeInstant(date: string, time: string, timeZone: string): string {
  const [year, month, day] = parseDay(date);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // The offset at the wall time read as UTC can be the offset from the other side of a change.
  const first = offsetMs(wall, timeZone);
  const second = offsetMs(wall - first, timeZone);
  const fits = (offset: number) => offsetMs(wall - offset, timeZone) === offset;
  // In a gap neither offset fits; the smaller one lands after the gap, east or west of UTC.
  const ms = fits(first)
    ? wall - first
    : fits(second)
      ? wall - second
      : wall - Math.min(first, second);
  return toInstant(ms, timeZone);
}

export function formatDay(date: string): string {
  const [, month, day] = parseDay(date);
  return `${day} ${MONTHS[month - 1]}`;
}

export function formatDayYear(date: string): string {
  return `${formatDay(date)} ${parseDay(date)[0]}`;
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function monthOf(word: string): number | null {
  const w = word.toLowerCase();
  const i = MONTH_NAMES.findIndex(
    (name) => w === name || w === name.slice(0, 3) || (name === 'september' && w === 'sept'),
  );
  return i < 0 ? null : i + 1;
}

/** Reads "6 Oct 2026", "6 October", or "2026-10-06"; without a year the day takes `year`. */
export function parseDayText(text: string, year: number): string | null {
  const t = text.trim();
  let y: number, m: number | null, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const words = /^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/.exec(t);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (words)
    [d, m, y] = [Number(words[1]), monthOf(words[2]), words[3] ? Number(words[3]) : year];
  else return null;
  if (!m || m > 12 || d < 1 || y < 1000) return null;
  const date = `${y}-${pad(m)}-${pad(d)}`;
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === date ? date : null;
}

/** Only whole text saves while the person types, so "6 Oct" never lands on this year mid-typing. */
export function completeDayText(text: string): string | null {
  const t = text.trim();
  return /^\d{4}-\d{2}-\d{2}$|\s\d{4}$/.test(t) ? parseDayText(t, 0) : null;
}

/** Reads "14:30", "1430", "930", "9" (09:00) or "9:5" (09:05) as a 24-hour `HH:mm`. */
export function parseTimeText(text: string): string | null {
  const t = text.trim();
  const split = /^(\d{1,2})[:.](\d{0,2})$/.exec(t);
  const digits = /^\d{1,4}$/.test(t) ? t : null;
  let hour: number, minute: number;
  if (split) [hour, minute] = [Number(split[1]), Number(split[2] || 0)];
  else if (digits && digits.length <= 2) [hour, minute] = [Number(digits), 0];
  else if (digits) [hour, minute] = [Number(digits.slice(0, -2)), Number(digits.slice(-2))];
  else return null;
  return hour < 24 && minute < 60 ? `${pad(hour)}:${pad(minute)}` : null;
}

/** Only whole text saves while the person types, so "25:00" never saves "2" as 02:00 on the way. */
export function completeTimeText(text: string): string | null {
  const t = text.trim();
  return /^\d{1,2}[:.]\d{2}$|^\d{4}$/.test(t) ? parseTimeText(t) : null;
}

export function timeSteps(stepMinutes = 30): string[] {
  const steps: string[] = [];
  for (let m = 0; m < 24 * 60; m += stepMinutes) steps.push(`${pad((m / 60) | 0)}:${pad(m % 60)}`);
  return steps;
}

export function formatMonth(date: string): string {
  const [year, month] = parseDay(date);
  const name = MONTH_NAMES[month - 1];
  return `${name[0].toUpperCase()}${name.slice(1)} ${year}`;
}

export function addMonths(date: string, n: number): string {
  const [year, month, day] = parseDay(date);
  const last = new Date(Date.UTC(year, month - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + n, Math.min(day, last))).toISOString().slice(0, 10);
}

/** Six weeks from Monday, so the calendar keeps one height from month to month. */
export function monthGrid(date: string): string[][] {
  const [year, month] = parseDay(date);
  const first = `${pad(year, 4)}-${pad(month)}-01`;
  const weekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const start = addDays(first, -weekday);
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)),
  );
}

export function formatStamp(instant: string, timeZone: string): string {
  const p = zoned(Date.parse(instant), timeZone);
  return `${p.day} ${MONTHS[p.month - 1]} ${pad(p.hour)}:${pad(p.minute)}`;
}
