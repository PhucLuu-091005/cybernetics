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
  if (!m || m > 12 || d < 1) return null;
  const date = `${y}-${pad(m)}-${pad(d)}`;
  return dayOf(`${date}T12:00:00Z`, 'UTC') === date ? date : null;
}

export function formatStamp(instant: string, timeZone: string): string {
  const p = zoned(Date.parse(instant), timeZone);
  return `${p.day} ${MONTHS[p.month - 1]} ${pad(p.hour)}:${pad(p.minute)}`;
}
