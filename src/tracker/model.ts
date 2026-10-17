export const EVENT_KINDS = [
  'message',
  'task',
  'handoff',
  'decision',
  'meeting',
  'delivery',
  'issue',
  'done',
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
};

export type Status = 'planned' | 'early' | 'ontime' | 'late' | 'flate';

export const STATUS_LABEL: Record<Status, string> = {
  planned: 'Planned',
  early: 'Finished early',
  ontime: 'Finished on time',
  late: 'Late',
  flate: 'Finished late',
};

export type Person = { id: string; name: string };

export type Team = { id: string; name: string; leadId: string | null };

/** Only milestone moves carry times: a milestone deadline can have a time of day (HH:mm). */
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
  firstPlannedFinish: string;
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
  addedBy: 'agent' | string | null;
  hidden: boolean;
};

export type QueueEvent = {
  id: string;
  kind: EventKind;
  at: string;
  by: string;
  text: string;
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
