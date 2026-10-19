import type { z } from 'zod';
import {
  FINISHES_NOTE,
  isFinishingHandoff,
  KIND_LABEL,
  kindText,
  type TrackerBase,
  type TrackerEvent,
  type TrackerQueue,
  type TrackerState,
  type WorkItem,
} from './model';
import type { QueueRow } from './payload';
import type { OpDescriptionSchema, OpSchema } from './schemas';
import { formatDeadline } from './deadline';
import { DEFAULT_TIME_ZONE, formatStamp } from './time';

export type Op = z.infer<typeof OpSchema>;
export type OpName = Op['op'];
export type OpOf<N extends OpName> = Extract<Op, { op: N }>;
export type OpDescription = z.infer<typeof OpDescriptionSchema>;
export type OpEntry = OpDescription & { i: number; skipped?: boolean; loop?: boolean };
export type Marks = {
  workItems: Set<string>;
  events: Set<string>;
  milestones: Set<string>;
  dates: Set<string>;
};
export type Replay = { state: TrackerState; entries: OpEntry[]; marks: Marks };

export class OpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpError';
  }
}

export class LoopError extends OpError {}

type Ctx = { by: string; timeZone: string };

function find<T extends { id: string }>(list: T[], id: string, what: string): T {
  const found = list.find((x) => x.id === id);
  if (!found) throw new OpError(`Unknown ${what} ${id}`);
  return found;
}

function takeFromQueue<T extends { id: string }>(list: T[], id: string): T {
  const index = list.findIndex((x) => x.id === id);
  if (index < 0) throw new OpError(`${id} is no longer in the queue`);
  return list.splice(index, 1)[0];
}

function assertNew(list: Array<{ id: string }>, id: string, what: string) {
  if (list.some((x) => x.id === id)) throw new OpError(`The ${what} ${id} already exists`);
}

function assertReason(why: string) {
  if (!why.trim()) throw new OpError('Write why the date moves.');
}

/** Parents and sources together form one tree for focus and layout, so a link must not close a loop. */
function assertNoLoop(s: TrackerState, item: { id: string; title: string }, start: string[]) {
  const seen = new Set<string>();
  const todo = [...start];
  while (todo.length) {
    const id = todo.pop()!;
    if (id === item.id)
      throw new LoopError(`${item.title}: this link would make a loop of parents and sources.`);
    if (seen.has(id)) continue;
    seen.add(id);
    const next = s.workItems.find((w) => w.id === id);
    if (next) todo.push(...(next.parentId ? [next.parentId] : []), ...next.after);
  }
}

function visibleEvent(s: TrackerState, id: string): TrackerEvent {
  const ev = find(s.events, id, 'event');
  if (ev.hidden) throw new OpError(`The event ${id} is hidden`);
  return ev;
}

const personName = (s: TrackerState, id: string) => s.people.find((p) => p.id === id)?.name ?? id;

const eventLabel = (s: TrackerState, ev: Pick<TrackerEvent, 'kind' | 'by' | 'finishes'>) =>
  `${KIND_LABEL[ev.kind]} by ${personName(s, ev.by)}${isFinishingHandoff(ev) ? `, ${FINISHES_NOTE}` : ''}`;

const finishFlag = (e: Pick<TrackerEvent, 'kind' | 'finishes'>): { finishes?: true } =>
  isFinishingHandoff(e) ? { finishes: true } : {};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function newItem(
  fields: Omit<WorkItem, 'firstPlannedFinish' | 'firstPlannedFinishTime' | 'moves'>,
): WorkItem {
  const { plannedFinishTime: time, ...rest } = fields;
  return {
    ...rest,
    ...(time ? { plannedFinishTime: time } : {}),
    firstPlannedFinish: fields.plannedFinish,
    ...(time ? { firstPlannedFinishTime: time } : {}),
    moves: [],
  };
}

function run(s: TrackerState, op: Op, c: Ctx): OpDescription {
  switch (op.op) {
    case 'attach': {
      const a = op.a;
      const item = find(s.workItems, a.workItemId, 'work item');
      const q = takeFromQueue(s.queue.events, a.eventId);
      assertNew(s.events, q.id, 'event');
      s.events.push({
        id: q.id,
        workItemId: item.id,
        kind: q.kind,
        at: q.at,
        by: q.by,
        text: q.text,
        ...finishFlag(q),
        addedBy: q.addedBy,
        hidden: false,
      });
      return {
        item: eventLabel(s, q),
        change: 'added',
        before: 'Queue',
        after: `${item.title}, ${formatStamp(q.at, c.timeZone)}`,
        icon: q.kind,
      };
    }
    case 'place': {
      const a = op.a;
      const team = find(s.teams, a.teamId, 'team');
      const q = takeFromQueue(s.queue.items, a.itemId);
      assertNew(s.workItems, q.id, 'work item');
      const milestone = q.milestoneId ? find(s.milestones, q.milestoneId, 'milestone') : null;
      const after = q.after ? find(s.workItems, q.after, 'work item') : null;
      s.workItems.push(
        newItem({
          id: q.id,
          title: q.title,
          teamId: team.id,
          doneBy: q.doneBy,
          requestedBy: q.requestedBy,
          milestoneId: q.milestoneId,
          parentId: null,
          after: after ? [after.id] : [],
          plannedFinish: a.plannedFinish ?? q.plannedFinish,
          plannedFinishTime: a.plannedFinish ? a.plannedFinishTime : q.plannedFinishTime,
          since: q.createdAt,
        }),
      );
      const bits = [team.name];
      if (milestone) bits.push(`milestone ${milestone.name}`);
      if (after) bits.push(`after ${after.title}`);
      return { item: q.title, change: 'placed', before: 'Queue', after: bits.join(', ') };
    }
    case 'qms': {
      const a = op.a;
      const q = find(s.queue.items, a.itemId, 'queue item');
      const milestone = find(s.milestones, a.milestoneId, 'milestone');
      const old = q.milestoneId ? s.milestones.find((m) => m.id === q.milestoneId) : undefined;
      q.milestoneId = milestone.id;
      return {
        item: q.title,
        change: 'milestone set',
        before: old ? old.name : 'No milestone',
        after: milestone.name,
      };
    }
    case 'fromEvent': {
      const a = op.a;
      const team = find(s.teams, a.teamId, 'team');
      if (a.after) find(s.workItems, a.after, 'work item');
      assertNew(s.workItems, a.id, 'work item');
      const q = takeFromQueue(s.queue.events, a.eventId);
      assertNew(s.events, q.id, 'event');
      s.workItems.push(
        newItem({
          id: a.id,
          title: a.title,
          teamId: team.id,
          doneBy: a.doneBy,
          requestedBy: a.requestedBy,
          milestoneId: null,
          parentId: null,
          after: a.after ? [a.after] : [],
          plannedFinish: a.plannedFinish,
          plannedFinishTime: a.plannedFinishTime,
          since: null,
        }),
      );
      s.events.push({
        id: q.id,
        workItemId: a.id,
        kind: q.kind,
        at: q.at,
        by: q.by,
        text: q.text,
        ...finishFlag(q),
        addedBy: q.addedBy,
        hidden: false,
      });
      return {
        item: a.title,
        change: 'added',
        before: 'Queue',
        after: `${team.name}, done by ${personName(s, a.doneBy)}`,
        icon: q.kind,
      };
    }
    case 'addEvent': {
      const { workItemId, ev } = op.a;
      const item = find(s.workItems, workItemId, 'work item');
      assertNew(s.events, ev.id, 'event');
      s.events.push({
        id: ev.id,
        kind: ev.kind,
        at: ev.at,
        by: ev.by,
        text: ev.text,
        ...finishFlag(ev),
        workItemId: item.id,
        addedBy: c.by,
        hidden: false,
      });
      return {
        item: eventLabel(s, ev),
        change: 'added',
        before: '',
        after: `${item.title}, ${formatStamp(ev.at, c.timeZone)}`,
        icon: ev.kind,
      };
    }
    case 'move': {
      const ev = visibleEvent(s, op.a.eventId);
      const to = find(s.workItems, op.a.to, 'work item');
      const from = find(s.workItems, ev.workItemId, 'work item');
      ev.workItemId = to.id;
      return {
        item: `${eventLabel(s, ev)}, ${formatStamp(ev.at, c.timeZone)}`,
        change: 'moved',
        before: from.title,
        after: to.title,
        icon: ev.kind,
      };
    }
    case 'kind': {
      const ev = visibleEvent(s, op.a.eventId);
      const before = kindText(ev);
      ev.kind = op.a.kind;
      if (finishFlag(op.a).finishes) ev.finishes = true;
      else delete ev.finishes;
      return {
        item: `Event by ${personName(s, ev.by)}, ${formatStamp(ev.at, c.timeZone)}`,
        change: 'changed',
        before,
        after: kindText(ev),
        icon: ev.kind,
      };
    }
    case 'hide': {
      const ev = visibleEvent(s, op.a.eventId);
      const item = find(s.workItems, ev.workItemId, 'work item');
      ev.hidden = true;
      return {
        item: `${eventLabel(s, ev)}, ${formatStamp(ev.at, c.timeZone)}`,
        change: 'hidden',
        before: `on ${item.title}`,
        after: 'Hidden',
        icon: ev.kind,
      };
    }
    case 'msDate': {
      const { milestoneId, date, time, why, by, at } = op.a;
      assertReason(why);
      const m = find(s.milestones, milestoneId, 'milestone');
      const old = m.planned;
      const oldTime = m.plannedTime;
      m.moves.push({
        from: old,
        ...(oldTime ? { fromTime: oldTime } : {}),
        to: date,
        ...(time ? { toTime: time } : {}),
        why,
        by,
        at,
      });
      m.planned = date;
      if (time) m.plannedTime = time;
      else delete m.plannedTime;
      return {
        item: m.name,
        change: 'planned date moved',
        before: `planned ${formatDeadline(old, oldTime)}`,
        after: `planned ${formatDeadline(date, time)}`,
        why,
      };
    }
    case 'msName': {
      const m = find(s.milestones, op.a.milestoneId, 'milestone');
      const old = m.name;
      m.name = op.a.name;
      return { item: m.name, change: 'renamed', before: old, after: m.name };
    }
    case 'msRemove': {
      const item = find(s.workItems, op.a.workItemId, 'work item');
      if (!item.milestoneId) throw new OpError(`${item.title} has no milestone`);
      const m = find(s.milestones, item.milestoneId, 'milestone');
      item.milestoneId = null;
      return {
        item: item.title,
        change: 'removed from milestone',
        before: m.name,
        after: 'No milestone',
      };
    }
    case 'msAdd': {
      const item = find(s.workItems, op.a.workItemId, 'work item');
      const m = find(s.milestones, op.a.milestoneId, 'milestone');
      if (item.milestoneId !== m.id) assertNoMilestone(s, item);
      const old = item.milestoneId
        ? s.milestones.find((x) => x.id === item.milestoneId)
        : undefined;
      item.milestoneId = m.id;
      return {
        item: item.title,
        change: 'milestone changed',
        before: old ? old.name : 'No milestone',
        after: m.name,
      };
    }
    case 'newMs': {
      const { id, name, planned, time, members } = op.a;
      assertNew(s.milestones, id, 'milestone');
      for (const item of s.workItems) if (members.includes(item.id)) assertNoMilestone(s, item);
      s.milestones.push({
        id,
        name,
        planned,
        ...(time ? { plannedTime: time } : {}),
        firstPlanned: planned,
        ...(time ? { firstPlannedTime: time } : {}),
        moves: [],
      });
      for (const item of s.workItems) if (members.includes(item.id)) item.milestoneId = id;
      return {
        item: name,
        change: 'added',
        before: '',
        after: `planned ${formatDeadline(planned, time)}, ${plural(members.length, 'work item')}`,
      };
    }
    case 'rename': {
      const item = find(s.workItems, op.a.workItemId, 'work item');
      const old = item.title;
      item.title = op.a.title;
      return { item: item.title, change: 'renamed', before: old, after: item.title };
    }
    case 'due': {
      const { workItemId, date, time, why, by, at } = op.a;
      assertReason(why);
      const item = find(s.workItems, workItemId, 'work item');
      const old = item.plannedFinish;
      const oldTime = item.plannedFinishTime;
      item.moves.push({
        from: old,
        ...(oldTime ? { fromTime: oldTime } : {}),
        to: date,
        ...(time ? { toTime: time } : {}),
        why,
        by,
        at,
      });
      item.plannedFinish = date;
      if (time) item.plannedFinishTime = time;
      else delete item.plannedFinishTime;
      return {
        item: item.title,
        change: 'planned finish moved',
        before: formatDeadline(old, oldTime),
        after: formatDeadline(date, time),
        why,
      };
    }
    case 'doneBy':
    case 'requestedBy': {
      const item = find(s.workItems, op.a.workItemId, 'work item');
      const person = find(s.people, op.a.personId, 'person');
      const old = item[op.op];
      item[op.op] = person.id;
      return {
        item: item.title,
        change: op.op === 'doneBy' ? 'done by changed' : 'requested by changed',
        before: personName(s, old),
        after: person.name,
      };
    }
    case 'team': {
      const item = find(s.workItems, op.a.workItemId, 'work item');
      const team = find(s.teams, op.a.teamId, 'team');
      const old = s.teams.find((t) => t.id === item.teamId);
      item.teamId = team.id;
      return {
        item: item.title,
        change: 'team changed',
        before: old?.name ?? '',
        after: team.name,
      };
    }
    case 'parent': {
      const item = find(s.workItems, op.a.workItemId, 'work item');
      const parent = op.a.parentId ? find(s.workItems, op.a.parentId, 'work item') : null;
      if (parent?.id === item.id) throw new OpError('A work item cannot be its own parent');
      if (parent) assertNoLoop(s, item, [parent.id]);
      const old = s.workItems.find((w) => w.id === item.parentId);
      item.parentId = parent?.id ?? null;
      return {
        item: item.title,
        change: 'parent changed',
        before: old?.title ?? 'No parent',
        after: parent?.title ?? 'No parent',
      };
    }
    case 'after': {
      const item = find(s.workItems, op.a.workItemId, 'work item');
      const sources = [...new Set(op.a.after)].map((id) => find(s.workItems, id, 'work item'));
      if (sources.some((w) => w.id === item.id))
        throw new OpError('A work item cannot lead from itself');
      assertNoLoop(
        s,
        item,
        sources.map((w) => w.id),
      );
      const titles = (ids: string[]) =>
        ids.map((id) => s.workItems.find((w) => w.id === id)?.title ?? id).join(', ') || 'Nothing';
      const before = titles(item.after);
      item.after = sources.map((w) => w.id);
      return { item: item.title, change: 'leads from changed', before, after: titles(item.after) };
    }
    case 'addTeam': {
      const { id, name, leadId } = op.a;
      // A merge also writes the team into the project's team list, which Main replays from.
      if (!s.teams.some((team) => team.id === id)) s.teams.push({ id, name, leadId });
      return {
        item: name,
        change: 'added',
        before: '',
        after: leadId ? `lead ${personName(s, leadId)}` : 'no lead',
      };
    }
    default:
      throw new OpError(`Unknown operation ${(op as { op: unknown }).op}`);
  }
}

/** A work item belongs to one milestone; a move is an explicit msRemove, then msAdd. */
function assertNoMilestone(s: TrackerState, item: WorkItem) {
  const m = item.milestoneId && s.milestones.find((x) => x.id === item.milestoneId);
  if (m)
    throw new OpError(
      `${item.title} is in ${m.name} already. Remove it from that milestone first.`,
    );
}

export function applyOp(
  state: TrackerState,
  op: Op,
  timeZone: string = DEFAULT_TIME_ZONE,
): { state: TrackerState; entry: OpDescription } {
  const next = structuredClone(state);
  const entry = run(next, op, { by: op.by, timeZone });
  return { state: next, entry };
}

function mark(marks: Marks, op: Op, state: TrackerState) {
  switch (op.op) {
    case 'attach':
    case 'move':
    case 'kind':
    case 'hide':
      marks.events.add(op.a.eventId);
      break;
    case 'addEvent':
      marks.events.add(op.a.ev.id);
      break;
    case 'fromEvent':
      marks.workItems.add(op.a.id);
      marks.events.add(op.a.eventId);
      break;
    case 'place':
      marks.workItems.add(op.a.itemId);
      break;
    case 'msDate':
      marks.milestones.add(op.a.milestoneId);
      // Prefixed because demo work items and milestones can share an id (golive).
      marks.dates.add(`ms:${op.a.milestoneId}`);
      break;
    case 'msName':
      marks.milestones.add(op.a.milestoneId);
      break;
    case 'newMs':
      marks.milestones.add(op.a.id);
      for (const id of op.a.members)
        if (state.workItems.some((w) => w.id === id)) marks.workItems.add(id);
      break;
    case 'msRemove':
    case 'msAdd':
    case 'rename':
    case 'doneBy':
    case 'requestedBy':
    case 'team':
    case 'parent':
    case 'after':
      marks.workItems.add(op.a.workItemId);
      break;
    case 'due':
      marks.workItems.add(op.a.workItemId);
      marks.dates.add(op.a.workItemId);
      break;
    case 'qms':
    case 'addTeam':
      break;
  }
}

export function replayOps(
  base: TrackerState,
  ops: readonly Op[],
  timeZone: string = DEFAULT_TIME_ZONE,
): Replay {
  let state = structuredClone(base);
  const entries: OpEntry[] = [];
  const marks: Marks = {
    workItems: new Set(),
    events: new Set(),
    milestones: new Set(),
    dates: new Set(),
  };
  ops.forEach((op, i) => {
    try {
      const applied = applyOp(state, op, timeZone);
      state = applied.state;
      entries.push({ ...applied.entry, i });
      mark(marks, op, state);
    } catch (err) {
      if (!(err instanceof OpError)) throw err;
      entries.push({
        i,
        item: op.d?.item ?? op.op,
        change: 'no longer applies',
        before: '',
        after: '',
        skipped: true,
        ...(err instanceof LoopError ? { loop: true } : {}),
      });
    }
  });
  return { state, entries, marks };
}

export function keysOf(op: Op): string[] {
  switch (op.op) {
    case 'attach':
    case 'fromEvent':
      return [`event:${op.a.eventId}`];
    case 'place':
    case 'qms':
      return [`item:${op.a.itemId}`];
    case 'move':
    case 'kind':
    case 'hide':
      return [`act:${op.a.eventId}`];
    case 'msDate':
      return [`ms:${op.a.milestoneId}:date`];
    case 'msName':
      return [`ms:${op.a.milestoneId}:name`];
    case 'msRemove':
    case 'msAdd':
      return [`loop:${op.a.workItemId}:ms`];
    case 'rename':
      return [`loop:${op.a.workItemId}:title`];
    case 'due':
      return [`loop:${op.a.workItemId}:due`];
    case 'doneBy':
    case 'requestedBy':
    case 'team':
    case 'parent':
    case 'after':
      return [`loop:${op.a.workItemId}:${op.op}`];
    default:
      return [];
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

// The server stamps every date move with its own by and at, so two moves to one date never match in full.
function compared(x: Pick<Op, 'op' | 'a'>): unknown {
  const op = x as Op;
  if (op.op === 'due') return [op.op, op.a.workItemId, op.a.date, op.a.time ?? null];
  if (op.op === 'msDate') return [op.op, op.a.milestoneId, op.a.date, op.a.time ?? null];
  return [op.op, op.a];
}

// Postgres jsonb reorders object keys, so a stored op and a fresh one must compare by content.
export function sameOp(x: Pick<Op, 'op' | 'a'>, y: Pick<Op, 'op' | 'a'>): boolean {
  return JSON.stringify(canonical(compared(x))) === JSON.stringify(canonical(compared(y)));
}

export function queueFromRows(rows: readonly QueueRow[]): TrackerQueue {
  const queue: TrackerQueue = { events: [], items: [] };
  for (const row of rows) {
    const queued = {
      id: row.id,
      addedBy: row.addedByMember,
      agent: row.addedByAgent,
      createdAt: row.createdAt,
    };
    if (row.kind === 'event') queue.events.push({ ...row.payload, ...queued });
    else queue.items.push({ ...row.payload, ...queued });
  }
  return queue;
}

const isRows = (queue: readonly QueueRow[] | TrackerQueue): queue is readonly QueueRow[] =>
  Array.isArray(queue);

export function initialState(
  base: TrackerBase,
  queue: readonly QueueRow[] | TrackerQueue,
): TrackerState {
  const { people, teams, milestones, workItems, events } = structuredClone(base);
  return {
    people,
    teams,
    milestones,
    workItems,
    events,
    queue: isRows(queue) ? queueFromRows(queue) : structuredClone(queue),
  };
}
