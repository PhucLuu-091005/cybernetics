import type { Due } from '../contracts/graph';

export interface BusinessCalendar {
  timeZone: string;
  holidays: readonly string[];
}
const DAY_MS = 86_400_000;
function dateEpoch(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('Expected YYYY-MM-DD date');
  const epoch = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== date)
    throw new RangeError('Invalid calendar date');
  return epoch;
}
function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
function formatDate(instant: Date, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function localDate(value: string | Date, timeZone: string): string {
  const formatter = dateFormatter(timeZone);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    dateEpoch(value);
    return value;
  }
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new RangeError('Invalid instant');
  return formatDate(instant, formatter);
}
/** Count whole local business days after a's date, through b's date. Reverse intervals are antisymmetric. */
export function businessDaysBetween(
  a: string | Date,
  b: string | Date,
  calendar: BusinessCalendar,
): number {
  const start = dateEpoch(localDate(a, calendar.timeZone));
  const end = dateEpoch(localDate(b, calendar.timeZone));
  if (start > end) return -businessDaysBetween(b, a, calendar);
  const holidays = new Set(calendar.holidays);
  let days = 0;
  for (let day = start + DAY_MS; day <= end; day += DAY_MS) {
    const date = new Date(day),
      weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(date.toISOString().slice(0, 10))) days++;
  }
  return days;
}
/** First representable instant of a local date, including zones where DST skips midnight. */
export function zonedStartOfDay(date: string, timeZone: string): string {
  const epoch = dateEpoch(date),
    formatter = dateFormatter(timeZone);
  let low = epoch - 2 * DAY_MS,
    high = epoch + 2 * DAY_MS;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (formatDate(new Date(middle), formatter) < date) low = middle + 1;
    else high = middle;
  }
  if (formatDate(new Date(low), formatter) !== date)
    throw new RangeError('Local date does not exist in this time zone');
  return new Date(low).toISOString();
}
/** A local wall time to an instant; one correction applies the offset in force at that time when a DST change falls after midnight. */
export function zonedInstant(date: string, time: string, timeZone: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new RangeError('Expected HH:mm time');
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const wallMinutes = (epoch: number) => {
    const parts = formatter.formatToParts(epoch);
    return (
      Number(parts.find((part) => part.type === 'hour')!.value) * 60 +
      Number(parts.find((part) => part.type === 'minute')!.value)
    );
  };
  const candidate = Date.parse(zonedStartOfDay(date, timeZone)) + minutes * 60_000;
  return new Date(candidate + (minutes - wallMinutes(candidate)) * 60_000).toISOString();
}
export function resolveDueInstant(due: Due, timeZone: string): string | null {
  if (due === null) return null;
  let day = dateEpoch(due.date);
  if (due.precision === 'week') day += ((7 - new Date(day).getUTCDay()) % 7) * DAY_MS;
  if (due.precision === 'month') {
    const end = new Date(day);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    day = end.getTime();
  }
  const nextDate = new Date(day + DAY_MS).toISOString().slice(0, 10);
  return new Date(Date.parse(zonedStartOfDay(nextDate, timeZone)) - 1).toISOString();
}
