import type { Milestone, WorkItem } from './model';
import { addDays, dayOf, formatDay, startOfDayInstant, wallTimeInstant } from './time';

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

export const itemDeadline = (
  w: Pick<WorkItem, 'plannedFinish' | 'plannedFinishTime'>,
  timeZone: string,
): number => deadlineMs(w.plannedFinish, w.plannedFinishTime, timeZone);

const HOUR = 3_600_000;

type Deadline = Pick<Milestone, 'planned' | 'plannedTime'>;

/** On the day of a deadline with a time, whole days would read "0 days", so it counts hours. */
function lateSpan(m: Deadline, asOf: string, timeZone: string): string {
  const today = dayOf(asOf, timeZone);
  if (today === m.planned) {
    const hours = Math.max(
      1,
      Math.ceil((Date.parse(asOf) - milestoneDeadline(m, timeZone)) / HOUR),
    );
    return `${hours} h`;
  }
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${m.planned}T00:00:00Z`)) / (24 * HOUR),
  );
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export const lateBadge = (m: Deadline, asOf: string, timeZone: string): string =>
  `Late by ${lateSpan(m, asOf, timeZone)}`;

export const formatDeadline = (date: string, time?: string | null): string =>
  time ? `${formatDay(date)} ${time}` : formatDay(date);
