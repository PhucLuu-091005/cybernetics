import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ActorContext } from '../../contracts';
import {
  mainState,
  QueueEventInputSchema,
  QueueItemInputSchema,
  type Commit,
  type Op,
  type TrackerPayload,
  type TrackerState,
} from '../../tracker';
import { AppError, invalidInput } from '../errors';
import { trackerQueue } from '../db/schema';
import { isId, withTransaction, type Db } from '../db/tx';
import { ProjectScopeSchema, requireMember, requireQueueWriter, writeScope } from './access';
import { buildPayload } from './read';
import { loadCommits, loadQueue } from './store';

const AddQueueEntryInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...ProjectScopeSchema,
    kind: z.literal('event'),
    fields: QueueEventInputSchema,
  }),
  z.strictObject({ ...ProjectScopeSchema, kind: z.literal('item'), fields: QueueItemInputSchema }),
]);
const DismissQueueEntryInputSchema = z.strictObject({
  ...ProjectScopeSchema,
  queueId: z.string().max(100),
});

type Entry = z.infer<typeof AddQueueEntryInputSchema>;

/** A card that names an unknown person, milestone or work item could never be placed. */
function unknownReferences(entry: Entry, main: TrackerState): string[] {
  const person = (field: string, id: string) =>
    main.people.some((p) => p.id === id) ? [] : [`${field}: no person ${id}`];
  if (entry.kind === 'event') return person('by', entry.fields.by);
  const { doneBy, requestedBy, milestoneId, after } = entry.fields;
  return [
    ...person('doneBy', doneBy),
    ...person('requestedBy', requestedBy),
    ...(milestoneId && !main.milestones.some((m) => m.id === milestoneId)
      ? [`milestoneId: no milestone ${milestoneId}`]
      : []),
    ...(after && !main.workItems.some((w) => w.id === after)
      ? [`after: no work item ${after}`]
      : []),
  ];
}

export async function addQueueEntry(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof AddQueueEntryInputSchema>,
): Promise<TrackerPayload> {
  const parsed = AddQueueEntryInputSchema.safeParse(raw);
  if (!parsed.success) throw invalidInput('Invalid queue card', parsed.error);
  const entry = parsed.data;
  return withTransaction(db, async (tx) => {
    const scope = await writeScope(tx, ctx, entry.projectId, entry.actAs);
    const me = requireQueueWriter(scope.me);
    const queue = await loadQueue(tx, scope.project.id);
    const commits = await loadCommits(tx, scope.project.id);
    const problems = unknownReferences(entry, mainState(scope.tracker.base, queue, commits));
    if (problems.length)
      throw new AppError('VALIDATION', 'The queue card names something Main does not have', {
        errors: problems.map((message) => ({ path: 'fields', message })),
      });
    await tx.insert(trackerQueue).values({
      ...scope.tenant,
      kind: entry.kind,
      payload: entry.fields,
      addedByMember: me.id,
      addedByAgent: ctx.kind === 'agent',
    });
    return buildPayload(tx, scope);
  });
}

const consumes = (op: Op, queueId: string) =>
  ((op.op === 'attach' || op.op === 'fromEvent') && op.a.eventId === queueId) ||
  (op.op === 'place' && op.a.itemId === queueId);

const usedByMain = (commits: readonly Commit[], queueId: string) =>
  commits.some((commit) => commit.ops.some((op) => consumes(op, queueId)));

export async function dismissQueueEntry(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof DismissQueueEntryInputSchema>,
): Promise<TrackerPayload> {
  const parsed = DismissQueueEntryInputSchema.safeParse(raw);
  if (!parsed.success) throw invalidInput('Invalid queue dismissal', parsed.error);
  const { projectId, queueId, actAs } = parsed.data;
  return withTransaction(db, async (tx) => {
    const scope = await writeScope(tx, ctx, projectId, actAs);
    requireMember(ctx, scope.me);
    const notFound = () => new AppError('NOT_FOUND', 'Queue card not found');
    if (!isId(queueId)) throw notFound();
    const match = and(
      eq(trackerQueue.projectId, scope.project.id),
      eq(trackerQueue.id, queueId),
      isNull(trackerQueue.dismissedAt),
    );
    const [row] = await tx.select({ id: trackerQueue.id }).from(trackerQueue).where(match);
    if (!row) throw notFound();
    // Main replays start from the queue, so removing a card that Main used would skip that change forever.
    if (usedByMain(await loadCommits(tx, scope.project.id), queueId))
      throw new AppError('CONFLICT', 'Main already uses this queue card');
    await tx
      .update(trackerQueue)
      .set({ dismissedAt: sql`now()` })
      .where(match);
    return buildPayload(tx, scope);
  });
}
