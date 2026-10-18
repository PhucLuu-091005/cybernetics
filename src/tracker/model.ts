export const EVENT_KINDS = [
  'message',
  'task',
  'handoff',
  'decision',
  'meeting',
  'delivery',
  'issue',
  'done',
  'idea',
  'cancelled',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const KIND_LABEL: Record<EventKind, string> = {
  message: 'Message',
  task: 'Task',
  handoff: 'Handoff',
  decision: 'Decision',
  meeting: 'Meeting',
  delivery: 'Delivery',
  issue: 'Issue',
  done: 'Done',
  idea: 'Idea',
  cancelled: 'Cancelled',
};

export const FINISHES_NOTE = 'finishes the work item';

export const isFinishingHandoff = (e: { kind: EventKind; finishes?: boolean }) =>
  e.kind === 'handoff' && e.finishes === true;

export const kindText = (e: { kind: EventKind; finishes?: boolean }) =>
  isFinishingHandoff(e) ? `${KIND_LABEL[e.kind]}, ${FINISHES_NOTE}` : KIND_LABEL[e.kind];

/** Guidance for the kind picker only: any kind can sit anywhere on a work item. */
export const KIND_GROUPS: ReadonlyArray<{ label: string; kinds: readonly EventKind[] }> = [
  { label: 'Start', kinds: ['idea', 'message', 'issue'] },
  { label: 'Progress', kinds: ['task', 'meeting', 'decision', 'delivery'] },
  { label: 'Finish', kinds: ['handoff', 'done', 'cancelled'] },
];

export type Status = 'planned' | 'early' | 'ontime' | 'late' | 'flate' | 'cancelled';

export const STATUS_LABEL: Record<Status, string> = {
  planned: 'Planned',
  early: 'Finished early',
  ontime: 'Finished on time',
  late: 'Late',
  flate: 'Finished late',
  cancelled: 'Cancelled',
};

export type Person = { id: string; name: string };

export type Team = { id: string; name: string; leadId: string | null };

/** A milestone deadline and a planned finish can have a time of day (HH:mm), so a move carries both. */
export type DateMove = {
  from: string;
  fromTime?: string;
  to: string;
  toTime?: string;
  why: string;
  by: string;
  at: string;
};

export type Milestone = {
  id: string;
  name: string;
  planned: string;
  plannedTime?: string;
  firstPlanned: string;
  firstPlannedTime?: string;
  moves: DateMove[];
};

export type WorkItem = {
  id: string;
  title: string;
  teamId: string;
  doneBy: string;
  requestedBy: string;
  milestoneId: string | null;
  parentId: string | null;
  after: string[];
  plannedFinish: string;
  plannedFinishTime?: string;
  firstPlannedFinish: string;
  firstPlannedFinishTime?: string;
  moves: DateMove[];
  since: string | null;
};

export type TrackerEvent = {
  id: string;
  workItemId: string;
  kind: EventKind;
  at: string;
  by: string;
  text: string;
  /** Only a Handoff reads it: true makes the Handoff finish its work item. */
  finishes?: boolean;
  addedBy: 'agent' | string | null;
  hidden: boolean;
};

export type QueueEvent = {
  id: string;
  kind: EventKind;
  at: string;
  by: string;
  text: string;
  finishes?: boolean;
  addedBy: string | null;
  agent: boolean;
  createdAt: string;
};

export type QueueItem = {
  id: string;
  title: string;
  note: string;
  doneBy: string;
  requestedBy: string;
  milestoneId: string | null;
  after: string | null;
  plannedFinish: string;
  plannedFinishTime?: string;
  addedBy: string | null;
  agent: boolean;
  createdAt: string;
};

export type TrackerQueue = { events: QueueEvent[]; items: QueueItem[] };

export type TrackerState = {
  people: Person[];
  teams: Team[];
  milestones: Milestone[];
  workItems: WorkItem[];
  events: TrackerEvent[];
  queue: TrackerQueue;
};

export type TrackerBase = Omit<TrackerState, 'queue'>;
