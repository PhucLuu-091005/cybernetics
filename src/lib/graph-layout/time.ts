import type { GraphContext } from '../../contracts/graph';
import { zonedStartOfDay } from '../calendar';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
// Contiguous filling from a neighbour costs two cached formatter calls per day; beyond this gap one exact search is cheaper.
const FILL_LIMIT = 400;
type Clock = Pick<GraphContext, 'timeZone' | 'windowStart'>;

const formatters = new Map<string, Intl.DateTimeFormat>();
function wallClock(epoch: number, timeZone: string): { date: string; time: string } {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(epoch)) parts[part.type] = part.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}
const isoDate = (epoch: number) => new Date(epoch).toISOString().slice(0, 10);
const pad = (value: number) => String(value).padStart(2, '0');

export interface TimeScale {
  x(instant: string): number;
  /** x of the centre of a local calendar date, where the approved design places date-only marks. */
  dateX(date: string): number;
  dateStartX(date: string): number;
  dateEndX(date: string): number;
  /** x of the start and the end of the local calendar day that contains the instant. */
  dayRange(instant: string): { start: number; end: number };
  localStamp(instant: string): string;
}

/**
 * Maps instants to x. Every local day is pxPerDay wide unless `dayWidths` resizes it; only days from the
 * window start onward can be resized, so x = 0 stays at the window start.
 */
export function createTimeScale(
  clock: Clock,
  pxPerDay: number,
  dayWidths: Readonly<Record<string, number>> = {},
): TimeScale {
  const { timeZone } = clock;
  const origin = Date.parse(`${clock.windowStart}T00:00:00Z`);
  const indexOf = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - origin) / DAY_MS);
  const deltas = Object.entries(dayWidths)
    .map(([date, width]) => [indexOf(date), width - pxPerDay] as const)
    .filter(([index, delta]) => index >= 0 && delta !== 0)
    .sort((a, b) => a[0] - b[0]);
  const widthAt = (index: number) => pxPerDay + (deltas.find(([at]) => at === index)?.[1] ?? 0);
  const offset = (index: number) =>
    index * pxPerDay + deltas.reduce((sum, [at, delta]) => (at < index ? sum + delta : sum), 0);
  const dateAt = (index: number) => isoDate(origin + index * DAY_MS);
  const exact = (index: number) => Date.parse(zonedStartOfDay(dateAt(index), timeZone));
  const verified = (index: number, candidate: number) =>
    wallClock(candidate, timeZone).date === dateAt(index) &&
    wallClock(candidate - 1, timeZone).date === dateAt(index - 1)
      ? candidate
      : exact(index);
  const starts = new Map<number, number>([[0, exact(0)]]);
  let low = 0,
    high = 0;
  function dayStart(index: number): number {
    const hit = starts.get(index);
    if (hit !== undefined) return hit;
    if (index > high && index - high <= FILL_LIMIT) {
      for (let k = high + 1; k <= index; k++)
        starts.set(k, verified(k, starts.get(k - 1)! + DAY_MS));
      high = index;
    } else if (index < low && low - index <= FILL_LIMIT) {
      for (let k = low - 1; k >= index; k--)
        starts.set(k, verified(k, starts.get(k + 1)! - DAY_MS));
      low = index;
    } else starts.set(index, exact(index));
    return starts.get(index)!;
  }
  function locate(epoch: number) {
    let index = Math.floor((epoch - starts.get(0)!) / DAY_MS);
    while (dayStart(index) > epoch) index--;
    while (dayStart(index + 1) <= epoch) index++;
    return { index, start: dayStart(index), length: dayStart(index + 1) - dayStart(index) };
  }
  const xs = new Map<string, number>();
  return {
    x(instant) {
      let value = xs.get(instant);
      if (value === undefined) {
        const epoch = Date.parse(instant);
        if (!Number.isFinite(epoch)) throw new RangeError(`Invalid instant ${instant}`);
        const day = locate(epoch);
        value = offset(day.index) + ((epoch - day.start) / day.length) * widthAt(day.index);
        xs.set(instant, value);
      }
      return value;
    },
    dateX: (date) => offset(indexOf(date)) + widthAt(indexOf(date)) / 2,
    dateStartX: (date) => offset(indexOf(date)),
    dateEndX: (date) => offset(indexOf(date) + 1),
    dayRange(instant) {
      const day = locate(Date.parse(instant));
      return { start: offset(day.index), end: offset(day.index + 1) };
    },
    localStamp(instant) {
      const epoch = Date.parse(instant),
        day = locate(epoch);
      if (day.length !== DAY_MS) {
        const wall = wallClock(epoch, timeZone);
        return `${wall.date} ${wall.time}`;
      }
      const minutes = Math.floor((epoch - day.start) / MINUTE_MS);
      return `${dateAt(day.index)} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    },
  };
}

export function xOf(t: string, context: Clock, pxPerDay: number): number {
  return createTimeScale(context, pxPerDay).x(t);
}
