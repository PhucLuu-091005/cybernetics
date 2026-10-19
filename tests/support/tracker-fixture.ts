import type { TrackerEvent, TrackerState, WorkItem } from '../../src/tracker/model';
import type { Op, OpName } from '../../src/tracker/ops';
import {
  at,
  LARKSPUR_STORY_NOW,
  LARKSPUR_TIME_ZONE,
  larkspurBase,
  larkspurQueueRows,
  larkspurState,
} from '../../src/server/tracker/seed/larkspur';

export { at, larkspurBase, larkspurQueueRows, larkspurState };
export const TIME_ZONE = LARKSPUR_TIME_ZONE;
export const AS_OF = LARKSPUR_STORY_NOW;

export function makeOp<N extends OpName>(
  op: N,
  a: Extract<Op, { op: N }>['a'],
  rev = 0,
  by = 'minh',
): Op {
  return { op, a, rev, by } as Op;
}

export function buildState(partial: Partial<TrackerState> = {}): TrackerState {
  return {
    people: [],
    teams: [],
    milestones: [],
    workItems: [],
    events: [],
    queue: { events: [], items: [] },
    ...partial,
  };
}

export function workItem(partial: Partial<WorkItem> & { id: string }): WorkItem {
  const plannedFinish = partial.plannedFinish ?? '2026-10-06';
  return {
    title: partial.id,
    teamId: 'team',
    doneBy: 'doer',
    requestedBy: 'asker',
    milestoneId: null,
    parentId: null,
    after: [],
    plannedFinish,
    firstPlannedFinish: plannedFinish,
    moves: [],
    since: null,
    ...partial,
  };
}

export function event(
  partial: Partial<TrackerEvent> & { id: string; workItemId: string },
): TrackerEvent {
  return {
    kind: 'task',
    at: at('2026-10-01T09:00'),
    by: 'doer',
    text: partial.id,
    addedBy: null,
    hidden: false,
    ...partial,
  };
}
