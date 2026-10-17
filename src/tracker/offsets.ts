import type { TrackerBase, TrackerEvent } from './model';
import type { Op } from './ops';
import type { QueueRow } from './payload';
import { addDays, dayOf, startOfDayInstant } from './time';

/** Minutes that one viewer moved an event inside its day, by event id; drawing only. */
export type Offsets = Readonly<Record<string, number>>;

const MINUTE = 60_000;

/** Measured on the project clock, so a 23-hour or 25-hour day keeps the icon inside that day. */
export function offsetRange(at: string, timeZone: string): { min: number; max: number } {
  const ms = Date.parse(at);
  const day = dayOf(at, timeZone);
  const start = Date.parse(startOfDayInstant(day, timeZone));
  const next = Date.parse(startOfDayInstant(addDays(day, 1), timeZone));
  return { min: Math.ceil((start - ms) / MINUTE) + 0, max: Math.floor((next - 1 - ms) / MINUTE) };
}

export function clampOffset(at: string, minutes: number | undefined, timeZone: string): number {
  if (minutes === undefined || !Number.isFinite(minutes)) return 0;
  const { min, max } = offsetRange(at, timeZone);
  return Math.min(max, Math.max(min, Math.round(minutes))) + 0;
}

export function drawnAt(
  event: Pick<TrackerEvent, 'id' | 'at'>,
  offsets: Offsets,
  timeZone: string,
): number {
  const minutes = Object.hasOwn(offsets, event.id) ? offsets[event.id] : undefined;
  return Date.parse(event.at) + clampOffset(event.at, minutes, timeZone) * MINUTE;
}

type Timed = Pick<TrackerEvent, 'id' | 'at' | 'workItemId'>;

const byTime = (a: Timed, b: Timed) =>
  Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const sameRowAndDay = (e: Timed, timeZone: string) => `${e.workItemId}|${dayOf(e.at, timeZone)}`;

/** Offsets saved before the drag kept the order could put an earlier event right of a later one. */
export function drawnTimes(
  events: readonly Timed[],
  offsets: Offsets,
  timeZone: string,
): Map<string, number> {
  const drawn = new Map<string, number>();
  const last = new Map<string, number>();
  for (const e of [...events].sort(byTime)) {
    const key = sameRowAndDay(e, timeZone);
    const at = Math.max(drawnAt(e, offsets, timeZone), last.get(key) ?? -Infinity);
    last.set(key, at);
    drawn.set(e.id, at);
  }
  return drawn;
}

export function clampDrag(
  event: Timed,
  minutes: number,
  events: readonly Timed[],
  offsets: Offsets,
  timeZone: string,
): number {
  const key = sameRowAndDay(event, timeZone);
  const row = events.filter((e) => sameRowAndDay(e, timeZone) === key);
  const drawn = drawnTimes(row, offsets, timeZone);
  let min = -Infinity;
  let max = Infinity;
  for (const e of row) {
    if (e.id === event.id) continue;
    const t = drawn.get(e.id)!;
    if (byTime(e, event) < 0) min = Math.max(min, t);
    else max = Math.min(max, t);
  }
  const at = Date.parse(event.at);
  const lo = Math.ceil((min - at) / MINUTE);
  const hi = Math.floor((max - at) / MINUTE);
  if (lo > hi) return clampOffset(event.at, lo, timeZone);
  return clampOffset(event.at, Math.min(hi, Math.max(lo, minutes)), timeZone);
}

export function offsetFor(at: string, drawnMs: number, timeZone: string): number {
  return clampOffset(at, (drawnMs - Date.parse(at)) / MINUTE, timeZone);
}

/** No operation changes the time of an event, so any view that has the event gives the same time. */
export function findEventAt(
  eventId: string,
  base: Pick<TrackerBase, 'events'>,
  queue: readonly QueueRow[],
  opLists: ReadonlyArray<readonly Op[]>,
): string | null {
  const known = base.events.find((e) => e.id === eventId);
  if (known) return known.at;
  const card = queue.find((row) => row.kind === 'event' && row.id === eventId);
  if (card?.kind === 'event') return card.payload.at;
  for (const ops of opLists)
    for (const op of ops) if (op.op === 'addEvent' && op.a.ev.id === eventId) return op.a.ev.at;
  return null;
}
