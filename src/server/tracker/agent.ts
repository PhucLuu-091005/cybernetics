import { z } from 'zod';
import { IdSchema, type ActorContext } from '../../contracts';
import {
  itemInfo,
  itemStatus,
  mainState,
  milestoneStatus,
  QueueEventInputSchema,
  QueueItemInputSchema,
  STATUS_LABEL,
  type Cr,
  type TrackerPayload,
} from '../../tracker';
import { AppError } from '../errors';
import type { Db } from '../db/tx';
import { invalid } from '../domain/records/metadata';
import { addQueueCard } from './queue';
import { getTrackerPayload } from './read';
import { mainRevision } from './store';

const CR_STATUSES = ['draft', 'ready', 'merged', 'closed'] as const;

export const TrackerInputSchema = z.strictObject({ projectId: IdSchema });
export const AddQueueEventInputSchema = z.strictObject({
  projectId: IdSchema,
  ...QueueEventInputSchema.shape,
});
export const AddQueueItemInputSchema = z.strictObject({
  projectId: IdSchema,
  ...QueueItemInputSchema.shape,
});
export const ListChangeRequestsInputSchema = z.strictObject({
  projectId: IdSchema,
  status: z.enum(CR_STATUSES).optional(),
});
export const GetChangeRequestInputSchema = z.strictObject({
  projectId: IdSchema,
  num: z.number().int().positive(),
});

const parse = <S extends z.ZodType>(schema: S, raw: unknown, what: string): z.infer<S> => {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalid(what, parsed.error);
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
    changes: cr.ops.length,
    updatedAt: cr.updatedAt,
  };
}

const main = (payload: TrackerPayload) => mainState(payload.base, payload.queue, payload.commits);

/** The demo clock decides statuses in a demo project, the same as in the browser. */
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
        firstPlanned: milestone.firstPlanned,
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
        firstPlannedFinish: item.firstPlannedFinish,
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

/** Main hides the cards that a merge used, so this is the Queue that people see. */
export async function listQueue(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof TrackerInputSchema>,
) {
  const { projectId } = parse(TrackerInputSchema, raw, 'Invalid queue read');
  return main(await getTrackerPayload(db, ctx, { projectId })).queue;
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
  const { projectId, status } = parse(
    ListChangeRequestsInputSchema,
    raw,
    'Invalid change request list',
  );
  const payload = await getTrackerPayload(db, ctx, { projectId });
  const who = whoIn(payload);
  return {
    items: payload.crs
      .filter((cr) => status === undefined || cr.status === status)
      .map((cr) => crSummary(cr, who)),
  };
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
      revision: cr.revision,
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
        createdAt: comment.createdAt,
      })),
    },
  };
}
