import type { TrackerBase } from './model';
import type { Op } from './ops';
import type { QueueRow } from './payload';
import { addDays, dayOf, startOfDayInstant } from './time';

const MINUTE = 60_000;

/**
 * The server still stores day offsets per viewer, but the graph draws every event at its own time,
 * so only the route that saves an offset reads this range.
 */
export function offsetRange(at: string, timeZone: string): { min: number; max: number } {
  const ms = Date.parse(at);
  const day = dayOf(at, timeZone);
  const start = Date.parse(startOfDayInstant(day, timeZone));
  const next = Date.parse(startOfDayInstant(addDays(day, 1), timeZone));
  return { min: Math.ceil((start - ms) / MINUTE) + 0, max: Math.floor((next - 1 - ms) / MINUTE) };
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
