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
  /** x of a placed event: its slot inside its day. Undefined for an ID the scale was not given. */
  eventX(id: string): number | undefined;
  localStamp(instant: string): string;
}

/** An event that needs room on the axis: `width` is its slot, and events of one lane never share room. */
export type TimedEvent = { id: string; at: string; lane: string; width: number };
// Distinct instants stay apart by a hair, so x keeps increasing with time.
const STEP = 2;

/**
 * Maps instants to x. A day without events is pxPerDay wide. A day with events (from the window start
 * onward) is wide enough for their slots, in time order, with no two slots of one lane overlapping; events
 * sit at their slot centres and other instants interpolate between them. `dayWidths` overrides a day's
 * width and scales its slots with it. x = 0 stays at the window start.
 */
export function createTimeScale(
  clock: Clock,
  pxPerDay: number,
  dayWidths: Readonly<Record<string, number>> = {},
  events: readonly TimedEvent[] = [],
): TimeScale {
  const { timeZone } = clock;
  const origin = Date.parse(`${clock.windowStart}T00:00:00Z`);
  const indexOf = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - origin) / DAY_MS);
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

  // Slots per day: [epoch, position] knots for interpolation, and the position of each event.
  const knots = new Map<number, [number, number][]>(),
    slotOf = new Map<string, { index: number; at: number }>(),
    autoWidth = new Map<number, number>();
  const byDay = new Map<number, { id: string; epoch: number; lane: string; width: number }[]>();
  for (const event of events) {
    const epoch = Date.parse(event.at),
      { index } = locate(epoch);
    if (index < 0) continue;
    byDay.set(index, [...(byDay.get(index) ?? []), { ...event, epoch }]);
  }
  for (const [index, list] of byDay) {
    list.sort((a, b) => a.epoch - b.epoch);
    const laneEnd = new Map<string, number>(),
      points: [number, number][] = [];
    let previous: { epoch: number; at: number } | null = null,
      right = 0;
    for (const event of list) {
      const at = Math.max(
        (laneEnd.get(event.lane) ?? 0) + event.width / 2,
        previous ? previous.at + (event.epoch > previous.epoch ? STEP : 0) : 0,
      );
      laneEnd.set(event.lane, at + event.width / 2);
      right = Math.max(right, at + event.width / 2);
      slotOf.set(event.id, { index, at });
      if (!previous || event.epoch > previous.epoch) points.push([event.epoch, at]);
      previous = { epoch: event.epoch, at };
    }
    knots.set(index, points);
    autoWidth.set(index, Math.max(pxPerDay, right));
  }
  const widths = new Map(autoWidth);
  for (const [date, width] of Object.entries(dayWidths)) {
    const index = indexOf(date);
    if (index >= 0) widths.set(index, width);
  }
  const widthAt = (index: number) => widths.get(index) ?? pxPerDay;
  const deltas = [...widths].filter(([, width]) => width !== pxPerDay);
  const offset = (index: number) =>
    index * pxPerDay +
    deltas.reduce((sum, [at, width]) => (at < index ? sum + width - pxPerDay : sum), 0);
  // A resized day scales its slots by the same factor.
  const factor = (index: number) => widthAt(index) / (autoWidth.get(index) ?? widthAt(index));
  function within(index: number, epoch: number, start: number, length: number): number {
    const width = widthAt(index),
      points = knots.get(index);
    if (!points?.length) return ((epoch - start) / length) * width;
    const scaled = factor(index);
    let fromEpoch = start,
      fromX = 0;
    for (const [knotEpoch, knotX] of points) {
      if (epoch <= knotEpoch)
        return (
          fromX + ((epoch - fromEpoch) / (knotEpoch - fromEpoch || 1)) * (knotX * scaled - fromX)
        );
      fromEpoch = knotEpoch;
      fromX = knotX * scaled;
    }
    return fromX + ((epoch - fromEpoch) / (start + length - fromEpoch || 1)) * (width - fromX);
  }
  const xs = new Map<string, number>();
  return {
    x(instant) {
      let value = xs.get(instant);
      if (value === undefined) {
        const epoch = Date.parse(instant);
        if (!Number.isFinite(epoch)) throw new RangeError(`Invalid instant ${instant}`);
        const day = locate(epoch);
        value = offset(day.index) + within(day.index, epoch, day.start, day.length);
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
    eventX(id) {
      const slot = slotOf.get(id);
      return slot && offset(slot.index) + slot.at * factor(slot.index);
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
