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

export function formatStamp(instant: string, timeZone: string): string {
  const p = zoned(Date.parse(instant), timeZone);
  return `${p.day} ${MONTHS[p.month - 1]} ${pad(p.hour)}:${pad(p.minute)}`;
}
