import type { Milestone, Status, TrackerEvent, WorkItem } from './model';
import { compareDay, dayOf } from './time';

export type ItemInfo = {
  events: TrackerEvent[];
  done: boolean;
  finishedAt: string | null;
  start: string | null;
  end: string | null;
};

const time = (instant: string) => Date.parse(instant);

export function itemInfo(item: WorkItem, events: readonly TrackerEvent[], asOf?: string): ItemInfo {
  const visible = events
    .filter((e) => e.workItemId === item.id && !e.hidden)
    .sort((a, b) => time(a.at) - time(b.at));
  const finish = [...visible].reverse().find((e) => e.kind === 'done');
  const finishedAt = finish ? finish.at : null;
  return {
    events: visible,
    done: !!finish,
    finishedAt,
    start: visible.length ? visible[0].at : null,
    end: finishedAt ?? asOf ?? null,
  };
}

function byFinish(finishDay: string, planned: string): Status {
  const order = compareDay(finishDay, planned);
  return order < 0 ? 'early' : order === 0 ? 'ontime' : 'flate';
}

const lateOrPlanned = (asOf: string, planned: string, timeZone: string): Status =>
  compareDay(dayOf(asOf, timeZone), planned) > 0 ? 'late' : 'planned';

export function itemStatus(
  item: WorkItem,
  events: readonly TrackerEvent[],
  asOf: string,
  timeZone: string,
): Status {
  const info = itemInfo(item, events);
  if (info.finishedAt) return byFinish(dayOf(info.finishedAt, timeZone), item.plannedFinish);
  return lateOrPlanned(asOf, item.plannedFinish, timeZone);
}

export function milestoneStatus(
  m: Milestone,
  items: readonly WorkItem[],
  events: readonly TrackerEvent[],
  asOf: string,
  timeZone: string,
): { status: Status; finishedAt: string | null; members: WorkItem[] } {
  const members = items.filter((item) => item.milestoneId === m.id);
  const finishes = members.map((item) => itemInfo(item, events).finishedAt);
  if (members.length && finishes.every((f) => f !== null)) {
    const finishedAt = finishes.reduce((a, b) => (time(b) > time(a) ? b : a));
    return { status: byFinish(dayOf(finishedAt, timeZone), m.planned), finishedAt, members };
  }
  return { status: lateOrPlanned(asOf, m.planned, timeZone), finishedAt: null, members };
}

const HOUR = 3_600_000;

/** Time from the first event to the finish (or to now while open), as "123 h (5.1 days)". */
export function timeSpent(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const ms = Math.max(0, time(end) - time(start));
  return `${Math.round(ms / HOUR)} h (${(ms / (24 * HOUR)).toFixed(1)} days)`;
}
