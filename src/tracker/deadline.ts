import type { Milestone, TrackerState } from './model';
import { addDays, formatDay, startOfDayInstant, wallTimeInstant } from './time';

export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Without a time the deadline is the last moment of its day, so every event of that day comes before it. */
export function deadlineMs(
  date: string,
  time: string | null | undefined,
  timeZone: string,
): number {
  if (time) return Date.parse(wallTimeInstant(date, time, timeZone));
  return Date.parse(startOfDayInstant(addDays(date, 1), timeZone)) - 1;
}

export const milestoneDeadline = (
  m: Pick<Milestone, 'planned' | 'plannedTime'>,
  timeZone: string,
): number => deadlineMs(m.planned, m.plannedTime, timeZone);

export const formatDeadline = (date: string, time?: string | null): string =>
  time ? `${formatDay(date)} ${time}` : formatDay(date);

export function deadlinesByItem(
  state: Pick<TrackerState, 'milestones' | 'workItems'>,
  timeZone: string,
): Map<string, number> {
  const byMs = new Map(state.milestones.map((m) => [m.id, milestoneDeadline(m, timeZone)]));
  const out = new Map<string, number>();
  for (const w of state.workItems) {
    const at = w.milestoneId ? byMs.get(w.milestoneId) : undefined;
    if (at !== undefined) out.set(w.id, at);
  }
  return out;
}
