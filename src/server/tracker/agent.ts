import { z } from 'zod';
import { IdSchema, type ActorContext } from '../../contracts';
import {
  itemInfo,
  itemStatus,
  mainState,
  milestoneStatus,
  QueueEventFieldsSchema,
  QueueItemInputSchema,
  STATUS_LABEL,
  type Cr,
  type QueueEvent,
  type QueueItem,
  type TrackerPayload,
} from '../../tracker';
import { AppError, invalidInput } from '../errors';
import type { Db } from '../db/tx';
import { addQueueCard } from './queue';
import { getTrackerPayload } from './read';
import { mainRevision } from './store';

const CR_STATUSES = ['draft', 'ready', 'merged', 'closed'] as const;

export const TrackerInputSchema = z.strictObject({ projectId: IdSchema });
export const AddQueueEventInputSchema = z.strictObject({
  projectId: IdSchema,
  ...QueueEventFieldsSchema.shape,
  by: QueueEventFieldsSchema.shape.by.optional(),
});
export const AddQueueItemInputSchema = z.strictObject({
  projectId: IdSchema,
  ...QueueItemInputSchema.shape,
});
const LimitSchema = z.number().int().min(1).max(200).default(50);
const QueueCursorSchema = z
  .string()
  .max(100)
  .transform((raw, context) => {
    const [time, id, ...rest] = raw.split('/');
    const at = Date.parse(time);
    if (
      rest.length ||
      !z.iso.datetime({ offset: true }).safeParse(time).success ||
      (id !== undefined && !IdSchema.safeParse(id).success)
    ) {
      context.addIssue({ code: 'custom', message: 'Use a created time or a nextBefore value' });
      return z.NEVER;
    }
    return { at, id: id ?? null };
  });
export const ListQueueInputSchema = z.strictObject({
  projectId: IdSchema,
  limit: LimitSchema,
  before: QueueCursorSchema.optional(),
});
export const ListChangeRequestsInputSchema = z.strictObject({
  projectId: IdSchema,
  status: z.enum(CR_STATUSES).optional(),
  limit: LimitSchema,
  before: z.number().int().positive().optional(),
});
export const GetChangeRequestInputSchema = z.strictObject({
  projectId: IdSchema,
  num: z.number().int().positive(),
});

const parse = <S extends z.ZodType>(schema: S, raw: unknown, what: string): z.infer<S> => {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalidInput(what, parsed.error);
  return parsed.data;
};

type Who = { id: string; name: string | null };
const whoIn =
  (payload: TrackerPayload) =>
  (id: string): Who => ({
    id,
    name: payload.members.find((member) => member.id === id)?.name ?? null,
  });

function crSummary(cr: Cr, who: (id: string) => Who) {
  return {
    num: cr.num,
    title: cr.title,
    status: cr.status,
    author: who(cr.author),
    editor: who(cr.editor),
    changeCount: cr.ops.length,
    revision: cr.revision,
    updatedAt: cr.updatedAt,
  };
}

/** What a change request write answers: the change request as it is now, small enough for any page. */
export function crBrief(payload: TrackerPayload, num: number) {
  const cr = payload.crs.find((item) => item.num === num);
  return { changeRequest: cr ? crSummary(cr, whoIn(payload)) : null };
}

const main = (payload: TrackerPayload) => mainState(payload.base, payload.queue, payload.commits);

// MCP refuses a result over 50,000 characters, so a page leaves room for the envelope and the cursor.
const PAGE_CHARS = 40_000;

/** The first entry always joins the page: one card or summary is far below the budget, so no page comes back empty. */
function takePage<T>(entries: readonly T[], limit: number): { taken: T[]; more: boolean } {
  let used = 0,
    end = 0;
  for (; end < entries.length && end < limit; end++) {
    used += JSON.stringify(entries[end]).length + 1;
    if (end > 0 && used > PAGE_CHARS) break;
  }
  return { taken: entries.slice(0, end), more: end < entries.length };
}

/** A project's fixed clock (`asOf`, set only in tests) decides the statuses, else now, as in the browser. */
export function trackerSummary(payload: TrackerPayload, now = new Date()) {
  const state = main(payload);
  const asOf = payload.project.asOf ?? now.toISOString();
  const timeZone = payload.project.timeZone;
  const who = whoIn(payload);
  return {
    title: payload.project.title,
    clientName: payload.project.clientName,
    demo: payload.project.demo,
    timeZone,
    asOf,
    revision: mainRevision(payload.commits),
    people: state.people,
    teams: state.teams,
    milestones: state.milestones.map((milestone) => {
      const { status, finishedAt, members } = milestoneStatus(
        milestone,
        state.workItems,
        state.events,
        asOf,
        timeZone,
      );
      return {
        id: milestone.id,
        name: milestone.name,
        planned: milestone.planned,
        plannedTime: milestone.plannedTime ?? null,
        firstPlanned: milestone.firstPlanned,
        firstPlannedTime: milestone.firstPlannedTime ?? null,
        status,
        statusLabel: STATUS_LABEL[status],
        finishedAt,
        workItemIds: members.map((item) => item.id),
      };
    }),
    workItems: state.workItems.map((item) => {
      const status = itemStatus(item, state.events, asOf, timeZone);
      return {
        id: item.id,
        title: item.title,
        teamId: item.teamId,
        parentId: item.parentId,
        after: item.after,
        milestoneId: item.milestoneId,
        doneBy: item.doneBy,
        requestedBy: item.requestedBy,
        plannedFinish: item.plannedFinish,
        plannedFinishTime: item.plannedFinishTime ?? null,
        firstPlannedFinish: item.firstPlannedFinish,
        firstPlannedFinishTime: item.firstPlannedFinishTime ?? null,
        status,
        statusLabel: STATUS_LABEL[status],
        finishedAt: itemInfo(item, state.events).finishedAt,
      };
    }),
    openChangeRequests: payload.crs
      .filter((cr) => cr.status === 'draft' || cr.status === 'ready')
      .map((cr) => crSummary(cr, who)),
  };
}

export async function getTrackerSummary(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof TrackerInputSchema>,
) {
  const { projectId } = parse(TrackerInputSchema, raw, 'Invalid tracker read');
  return trackerSummary(await getTrackerPayload(db, ctx, { projectId }));
}

type QueueEntry = { kind: 'event'; card: QueueEvent } | { kind: 'item'; card: QueueItem };
const newestFirst = (a: QueueEntry, b: QueueEntry) =>
  Date.parse(b.card.createdAt) - Date.parse(a.card.createdAt) ||
  (a.card.id < b.card.id ? 1 : a.card.id > b.card.id ? -1 : 0);

/**
 * Main hides the cards that a merge used, so this is the Queue that people see.
 * nextBefore carries the id after the created time, so cards that share a created time are never skipped between pages.
 */
export async function listQueue(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof ListQueueInputSchema>,
) {
  const { projectId, limit, before } = parse(ListQueueInputSchema, raw, 'Invalid queue read');
  const { events, items } = main(await getTrackerPayload(db, ctx, { projectId })).queue;
  const entries = [
    ...events.map((card): QueueEntry => ({ kind: 'event', card })),
    ...items.map((card): QueueEntry => ({ kind: 'item', card })),
  ]
    .filter(({ card }) => {
      if (!before) return true;
      const at = Date.parse(card.createdAt);
      return at < before.at || (at === before.at && before.id !== null && card.id < before.id);
    })
    .sort(newestFirst);
  const { taken, more } = takePage(entries, limit);
  const last = taken.at(-1)?.card;
  return {
    events: taken.flatMap((entry) => (entry.kind === 'event' ? [entry.card] : [])),
    items: taken.flatMap((entry) => (entry.kind === 'item' ? [entry.card] : [])),
    nextBefore: more && last ? `${new Date(last.createdAt).toISOString()}/${last.id}` : null,
  };
}

/** Returns only the new card, so a token with queue:add alone reads nothing else. */
export async function addQueueEvent(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof AddQueueEventInputSchema>,
) {
  const { projectId, ...fields } = parse(AddQueueEventInputSchema, raw, 'Invalid queue event');
  const { id, payload } = await addQueueCard(db, ctx, { projectId, kind: 'event', fields });
  return { event: payload.queue.events.find((event) => event.id === id) };
}

export async function addQueueItem(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof AddQueueItemInputSchema>,
) {
  const { projectId, ...fields } = parse(AddQueueItemInputSchema, raw, 'Invalid queue item');
  const { id, payload } = await addQueueCard(db, ctx, { projectId, kind: 'item', fields });
  return { item: payload.queue.items.find((item) => item.id === id) };
}

export async function listChangeRequests(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof ListChangeRequestsInputSchema>,
) {
  const { projectId, status, limit, before } = parse(
    ListChangeRequestsInputSchema,
    raw,
    'Invalid change request list',
  );
  const payload = await getTrackerPayload(db, ctx, { projectId });
  const who = whoIn(payload);
  const summaries = payload.crs
    .filter((cr) => status === undefined || cr.status === status)
    .filter((cr) => before === undefined || cr.num < before)
    .sort((a, b) => b.num - a.num)
    .map((cr) => crSummary(cr, who));
  const { taken, more } = takePage(summaries, limit);
  return { items: taken, nextBefore: more ? taken.at(-1)!.num : null };
}

export async function getChangeRequest(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof GetChangeRequestInputSchema>,
) {
  const { projectId, num } = parse(GetChangeRequestInputSchema, raw, 'Invalid change request');
  const payload = await getTrackerPayload(db, ctx, { projectId });
  const cr = payload.crs.find((item) => item.num === num);
  if (!cr) throw new AppError('NOT_FOUND', `Change request #${num} not found`);
  const who = whoIn(payload);
  const maybe = (id: string | null) => (id === null ? null : who(id));
  return {
    changeRequest: {
      ...crSummary(cr, who),
      createdAt: cr.createdAt,
      mergedRev: cr.mergedRev,
      mergedBy: maybe(cr.mergedBy),
      mergedAt: cr.mergedAt,
      closedBy: maybe(cr.closedBy),
      closedAt: cr.closedAt,
      changes: cr.ops.map((op, index) => ({
        index,
        op: op.op,
        by: who(op.by),
        agent: op.agent === true,
        viaKey: op.via ?? null,
        description: op.d ?? null,
      })),
      resolutions: cr.resolutions,
      shares: cr.shares.map((share) => ({
        member: who(share.memberId),
        permission: share.permission,
      })),
      asks: cr.asks.map((ask) => ({ member: who(ask.memberId), createdAt: ask.createdAt })),
      comments: cr.comments.map((comment) => ({
        by: who(comment.memberId),
        kind: comment.kind,
        body: comment.body,
        opIndex: comment.opIndex,
        agent: comment.agent,
        viaKey: comment.viaKey,
        createdAt: comment.createdAt,
      })),
    },
  };
}
