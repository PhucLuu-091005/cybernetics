export interface BusinessCalendar { timeZone: string; holidays: readonly string[] }
const DAY_MS = 86_400_000;
export function localDate(value: string | Date, timeZone: string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new RangeError('Invalid instant');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function businessDaysBetween(a: string | Date, b: string | Date, calendar: BusinessCalendar): number {
  const start = Date.parse(`${localDate(a, calendar.timeZone)}T00:00:00Z`);
  const end = Date.parse(`${localDate(b, calendar.timeZone)}T00:00:00Z`);
  if (start > end) return -businessDaysBetween(b, a, calendar);
  const holidays = new Set(calendar.holidays);
  let days = 0;
  for (let day = start + DAY_MS; day <= end; day += DAY_MS) {
    const date = new Date(day), weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(date.toISOString().slice(0, 10))) days++;
  }
  return days;
}
