import {
  isFinishingHandoff,
  type EventKind,
  type Milestone,
  type Status,
  type TrackerEvent,
  type WorkItem,
} from './model';
import { itemDeadline, milestoneDeadline } from './deadline';
import { compareDay, dayOf } from './time';

export type ItemInfo = {
  events: TrackerEvent[];
  /** Finished by its last finishing event, a cancel included. */
  done: boolean;
  cancelled: boolean;
  finishedAt: string | null;
  start: string | null;
  end: string | null;
};

const time = (instant: string) => Date.parse(instant);

export function finishesItem(e: Pick<TrackerEvent, 'kind' | 'finishes'>): boolean {
  return e.kind === 'done' || e.kind === 'cancelled' || isFinishingHandoff(e);
}

const sortedVisible = (item: WorkItem, events: readonly TrackerEvent[]) =>
  events
    .filter((e) => e.workItemId === item.id && !e.hidden)
    .sort((a, b) => time(a.at) - time(b.at));

export function itemInfo(item: WorkItem, events: readonly TrackerEvent[], asOf?: string): ItemInfo {
  const visible = sortedVisible(item, events);
  const finish = [...visible].reverse().find(finishesItem);
  const finishedAt = finish ? finish.at : null;
  return {
    events: visible,
    done: !!finish,
    cancelled: finish?.kind === 'cancelled',
    finishedAt,
    start: visible.length ? visible[0].at : null,
    end: finishedAt ?? asOf ?? null,
  };
}

function byFinish(finishDay: string, planned: string): Status {
  const order = compareDay(finishDay, planned);
  return order < 0 ? 'early' : order === 0 ? 'ontime' : 'flate';
}

export function itemStatus(
  item: WorkItem,
  events: readonly TrackerEvent[],
  asOf: string,
  timeZone: string,
): Status {
  const info = itemInfo(item, events);
  if (info.cancelled) return 'cancelled';
  const deadline = itemDeadline(item, timeZone);
  if (info.finishedAt)
    return time(info.finishedAt) > deadline
      ? 'flate'
      : byFinish(dayOf(info.finishedAt, timeZone), item.plannedFinish);
  return time(asOf) > deadline ? 'late' : 'planned';
}

export function milestoneStatus(
  m: Milestone,
  items: readonly WorkItem[],
  events: readonly TrackerEvent[],
  asOf: string,
  timeZone: string,
): { status: Status; finishedAt: string | null; members: WorkItem[] } {
  const members = items.filter((item) => item.milestoneId === m.id);
  const infos = members.map((item) => itemInfo(item, events));
  const live = infos.filter((info) => !info.cancelled);
  // A cancelled member never holds its milestone back; when all are cancelled, the latest cancel finishes it.
  const finishes = (live.length ? live : infos).map((info) => info.finishedAt);
  const deadline = milestoneDeadline(m, timeZone);
  if (members.length && finishes.every((f) => f !== null)) {
    const finishedAt = finishes.reduce((a, b) => (time(b) > time(a) ? b : a));
    const status =
      time(finishedAt) > deadline ? 'flate' : byFinish(dayOf(finishedAt, timeZone), m.planned);
    return { status, finishedAt, members };
  }
  return { status: time(asOf) > deadline ? 'late' : 'planned', finishedAt: null, members };
}

const START_HINT_KINDS: readonly EventKind[] = ['delivery', 'handoff', 'done'];

/** The kind of the first visible event when it tells of a result, so the start of the work is missing. */
export function startHint(item: WorkItem, events: readonly TrackerEvent[]): EventKind | null {
  const first = sortedVisible(item, events)[0];
  return first && START_HINT_KINDS.includes(first.kind) ? first.kind : null;
}

const HOUR = 3_600_000;

export function timeSpent(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const ms = Math.max(0, time(end) - time(start));
  const hours = Math.round(ms / HOUR);
  return hours < 24 ? `${hours} h` : `${hours} h (${(ms / (24 * HOUR)).toFixed(1)} days)`;
}
