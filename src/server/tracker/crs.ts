import { and, eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { RevisionSchema, type ActorContext } from '../../contracts';
import {
  applyOp,
  clashesOf,
  clashLabel,
  liveOps,
  mainState,
  noNul,
  OpError,
  OpSchema,
  replayOps,
  type Commit,
  type Member,
  type Op,
  type QueueRow,
  type Resolution,
  type TrackerPayload,
  type TrackerState,
} from '../../tracker';
import { AppError, invalidInput } from '../errors';
import { trackerCommits, trackerCrAsks, trackerCrShares, trackerCrs } from '../db/schema';
import { withTransaction, type Db, type Tx } from '../db/tx';
import {
  hasEditRight,
  loadShares,
  OPEN,
  ProjectScopeSchema,
  requireEditor,
  requireMember,
  requireOwner,
  requireStatus,
  writeScope,
  type Scope,
} from './access';
import { buildPayload } from './read';
import { addComment, loadCommits, loadQueue, lockCr, mainRevision, type CrRow } from './store';

const MAX_OPS = 500;
const Text = (max: number) => noNul(z.string().trim().min(1, 'Must not be empty').max(max));
const RouteNumber = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^\d{1,9}$/)
      .transform(Number),
  ])
  .pipe(z.number().int().nonnegative());
const MemberId = z.string().max(100);
const Target = { ...ProjectScopeSchema, num: RouteNumber.pipe(z.number().positive()) };
const Seen = { ...Target, expectedRevision: RevisionSchema.optional() };
/** The owner decides on what they saw, so merge, close and request changes must name that revision. */
const Reviewed = { ...Target, expectedRevision: RevisionSchema };

const CreateCrInputSchema = z.strictObject({
  ...ProjectScopeSchema,
  title: Text(200),
  ops: z.array(z.unknown()).max(MAX_OPS).optional(),
});
const AppendOpInputSchema = z.strictObject({
  ...Target,
  op: z.unknown(),
  expectedRevision: RevisionSchema,
});
const RemoveOpInputSchema = z.strictObject({
  ...Target,
  index: z.union([z.literal('last'), RouteNumber]),
  expectedRevision: RevisionSchema,
});
const CrActionInputSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...Seen, action: z.literal('ready') }),
  z.strictObject({ ...Seen, action: z.literal('unready') }),
  z.strictObject({ ...Seen, action: z.literal('ask') }),
  z.strictObject({ ...Seen, action: z.literal('cancel-ask') }),
  z.strictObject({ ...Seen, action: z.literal('handover'), to: MemberId }),
  z.strictObject({ ...Seen, action: z.literal('decline'), who: MemberId }),
  z.strictObject({
    ...Seen,
    action: z.literal('share'),
    memberId: MemberId,
    permission: z.enum(['edit', 'view', 'remove']),
  }),
  z.strictObject({
    ...Seen,
    action: z.literal('comment'),
    body: Text(4000),
    opIndex: z.number().int().nonnegative().nullish(),
  }),
  z.strictObject({
    ...Reviewed,
    action: z.literal('merge'),
    picks: z.record(z.string().max(300), z.enum(['main', 'cr'])).default({}),
  }),
  z.strictObject({ ...Reviewed, action: z.literal('request-changes'), note: Text(4000) }),
  z.strictObject({ ...Reviewed, action: z.literal('close') }),
]);
export type CrActionInput = z.input<typeof CrActionInputSchema>;
type Action = z.infer<typeof CrActionInputSchema>;

const parse = <S extends z.ZodType>(schema: S, raw: unknown, what: string): z.infer<S> => {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalidInput(what, parsed.error);
  return parsed.data;
};

/** The server owns rev, by and d, and records who moved a date and when. */
function candidate(raw: unknown, rev: number, by: string): Op {
  const value = (raw ?? {}) as { op?: unknown; a?: unknown };
  const a =
    (value.op === 'due' || value.op === 'msDate') && value.a && typeof value.a === 'object'
      ? { ...value.a, by, at: new Date().toISOString() }
      : value.a;
  return parse(OpSchema, { op: value.op, a, rev, by }, 'Invalid change');
}

function stillApplying(state: TrackerState, ops: readonly Op[], tz: string): Op[] {
  const kept: Op[] = [];
  for (const op of ops) {
    try {
      const applied = applyOp(state, op, tz);
      state = applied.state;
      kept.push({ ...op, d: applied.entry });
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
    }
  }
  return kept;
}

type Main = { base: Scope['tracker']['base']; queue: QueueRow[]; commits: Commit[] };

async function loadMain(tx: Tx, scope: Scope): Promise<Main> {
  const queue = await loadQueue(tx, scope.project.id);
  const commits = await loadCommits(tx, scope.project.id);
  return { base: scope.tracker.base, queue, commits };
}

/** Each new op must apply on the latest Main plus the live ops before it. */
function admit(
  main: Main,
  before: readonly Op[],
  raws: readonly unknown[],
  by: string,
  tz: string,
) {
  const rev = mainRevision(main.commits);
  let state: TrackerState = replayOps(
    mainState(main.base, main.queue, main.commits),
    liveOps(before, main.commits),
    tz,
  ).state;
  return raws.map((raw) => {
    const op = candidate(raw, rev, by);
    try {
      const applied = applyOp(state, op, tz);
      state = applied.state;
      return { ...op, d: applied.entry };
    } catch (error) {
      if (error instanceof OpError)
        throw new AppError('VALIDATION', `The change does not fit: ${error.message}`);
      throw error;
    }
  });
}

function requireRevision(cr: CrRow, expected: number) {
  if (cr.revision !== expected)
    throw new AppError('CONFLICT', `#${cr.num} changed. Reload it and try again.`, {
      details: { revision: cr.revision, status: cr.status },
    });
}

async function updateCr(tx: Tx, cr: CrRow, set: PgUpdateSetSource<typeof trackerCrs>) {
  await tx
    .update(trackerCrs)
    .set({ ...set, revision: cr.revision + 1, updatedAt: sql`now()` })
    .where(and(eq(trackerCrs.projectId, cr.projectId), eq(trackerCrs.id, cr.id)));
}

async function touchCr(tx: Tx, cr: CrRow) {
  await tx
    .update(trackerCrs)
    .set({ updatedAt: sql`now()` })
    .where(and(eq(trackerCrs.projectId, cr.projectId), eq(trackerCrs.id, cr.id)));
}

const askOf = (cr: CrRow, memberId: string) =>
  and(
    eq(trackerCrAsks.projectId, cr.projectId),
    eq(trackerCrAsks.crId, cr.id),
    eq(trackerCrAsks.memberId, memberId),
  );
const asksOf = (cr: CrRow) =>
  and(eq(trackerCrAsks.projectId, cr.projectId), eq(trackerCrAsks.crId, cr.id));

function memberOf(scope: Scope, id: string): Member {
  const member = scope.members.find((item) => item.id === id);
  if (!member) throw new AppError('VALIDATION', `${id} is not a member of this project`);
  return member;
}

export async function createCr(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof CreateCrInputSchema>,
): Promise<{ num: number; payload: TrackerPayload }> {
  const input = parse(CreateCrInputSchema, raw, 'Invalid change request');
  return withTransaction(db, async (tx) => {
    const scope = await writeScope(tx, ctx, input.projectId, input.actAs);
    const me = requireMember(ctx, scope.me);
    const main = await loadMain(tx, scope);
    const ops = admit(main, [], input.ops ?? [], me.id, scope.tracker.timeZone);
    const [{ num }] = await tx
      .select({ num: sql<number>`coalesce(max(${trackerCrs.num}), 0)::int + 1` })
      .from(trackerCrs)
      .where(eq(trackerCrs.projectId, scope.project.id));
    const [cr] = await tx
      .insert(trackerCrs)
      .values({
        ...scope.tenant,
        num,
        title: input.title,
        author: me.id,
        editor: me.id,
        status: 'draft',
        ops,
      })
      .returning({ id: trackerCrs.id });
    await addComment(tx, scope.tenant, { crId: cr.id, memberId: me.id, kind: 'created' });
    return { num, payload: await buildPayload(tx, scope) };
  });
}

export async function appendOp(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof AppendOpInputSchema>,
): Promise<TrackerPayload> {
  const input = parse(AppendOpInputSchema, raw, 'Invalid change');
  return withTransaction(db, async (tx) => {
    const scope = await writeScope(tx, ctx, input.projectId, input.actAs);
    const cr = await lockCr(tx, scope.project.id, input.num);
    const me = requireEditor(ctx, scope, cr);
    requireStatus(cr, ['draft']);
    requireRevision(cr, input.expectedRevision);
    if (cr.ops.length >= MAX_OPS)
      throw new AppError('LIMIT_EXCEEDED', `#${cr.num} already has ${MAX_OPS} changes`);
    const main = await loadMain(tx, scope);
    const [op] = admit(main, cr.ops, [input.op], me.id, scope.tracker.timeZone);
    await updateCr(tx, cr, { ops: [...cr.ops, op] });
    return buildPayload(tx, scope);
  });
}

export async function removeOp(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof RemoveOpInputSchema>,
): Promise<TrackerPayload> {
  const input = parse(RemoveOpInputSchema, raw, 'Invalid change removal');
  return withTransaction(db, async (tx) => {
    const scope = await writeScope(tx, ctx, input.projectId, input.actAs);
    const cr = await lockCr(tx, scope.project.id, input.num);
    requireEditor(ctx, scope, cr);
    requireStatus(cr, ['draft']);
    requireRevision(cr, input.expectedRevision);
    const index = input.index === 'last' ? cr.ops.length - 1 : input.index;
    if (index < 0 || index >= cr.ops.length)
      throw new AppError('VALIDATION', `#${cr.num} has no change ${input.index}`);
    await updateCr(tx, cr, { ops: cr.ops.filter((_, i) => i !== index) });
    return buildPayload(tx, scope);
  });
}

type Run = { tx: Tx; ctx: ActorContext; scope: Scope; cr: CrRow; expectedRevision?: number };

const requireSeen = ({ cr, expectedRevision }: Run) => {
  if (expectedRevision !== undefined) requireRevision(cr, expectedRevision);
};

async function ready(run: Run) {
  const { tx, ctx, scope, cr } = run;
  const me = requireEditor(ctx, scope, cr);
  requireStatus(cr, ['draft']);
  requireSeen(run);
  if (!cr.ops.length)
    throw new AppError('VALIDATION', 'Add at least one change before you mark it as ready');
  await updateCr(tx, cr, { status: 'ready' });
  await addComment(tx, scope.tenant, { crId: cr.id, memberId: me.id, kind: 'ready' });
}

async function unready(run: Run) {
  const { tx, ctx, scope, cr } = run;
  const me = requireEditor(ctx, scope, cr);
  requireStatus(cr, ['ready']);
  requireSeen(run);
  await updateCr(tx, cr, { status: 'draft' });
  await addComment(tx, scope.tenant, { crId: cr.id, memberId: me.id, kind: 'unready' });
}

async function ask(run: Run) {
  const { tx, ctx, scope, cr } = run;
  const me = requireMember(ctx, scope.me);
  requireStatus(cr, OPEN);
  requireSeen(run);
  if (cr.editor === me.id) throw new AppError('VALIDATION', `You already edit #${cr.num}`);
  if (!hasEditRight(cr, await loadShares(tx, cr), me.id))
    throw new AppError('FORBIDDEN', `You can only view #${cr.num}`);
  const added = await tx
    .insert(trackerCrAsks)
    .values({ ...scope.tenant, crId: cr.id, memberId: me.id })
    .onConflictDoNothing()
    .returning({ memberId: trackerCrAsks.memberId });
  if (!added.length) return;
  await touchCr(tx, cr);
  await addComment(tx, scope.tenant, { crId: cr.id, memberId: me.id, kind: 'ask' });
}

async function cancelAsk(run: Run) {
  const { tx, ctx, scope, cr } = run;
  const me = requireMember(ctx, scope.me);
  requireSeen(run);
  const removed = await tx
    .delete(trackerCrAsks)
    .where(askOf(cr, me.id))
    .returning({ memberId: trackerCrAsks.memberId });
  if (removed.length) await touchCr(tx, cr);
}

async function handover(run: Run, to: string) {
  const { tx, ctx, scope, cr } = run;
  const me = requireEditor(ctx, scope, cr);
  requireStatus(cr, OPEN);
  requireSeen(run);
  const next = memberOf(scope, to);
  if (next.id === me.id) throw new AppError('VALIDATION', `You already edit #${cr.num}`);
  if (!hasEditRight(cr, await loadShares(tx, cr), next.id))
    throw new AppError('FORBIDDEN', `${next.name} cannot edit #${cr.num}. Share it first.`);
  await updateCr(tx, cr, { editor: next.id });
  await tx.delete(trackerCrAsks).where(askOf(cr, next.id));
  await addComment(tx, scope.tenant, {
    crId: cr.id,
    memberId: me.id,
    kind: 'handover',
    body: `${next.name} edits now.`,
  });
}

async function decline(run: Run, who: string) {
  const { tx, ctx, scope, cr } = run;
  const me = requireEditor(ctx, scope, cr);
  requireStatus(cr, OPEN);
  requireSeen(run);
  const asker = memberOf(scope, who);
  const removed = await tx
    .delete(trackerCrAsks)
    .where(askOf(cr, asker.id))
    .returning({ memberId: trackerCrAsks.memberId });
  if (!removed.length)
    throw new AppError('VALIDATION', `${asker.name} did not ask to edit #${cr.num}`);
  await touchCr(tx, cr);
  await addComment(tx, scope.tenant, {
    crId: cr.id,
    memberId: me.id,
    kind: 'decline',
    body: `Not now, ${asker.name.split(' ')[0]}.`,
  });
}

async function share(run: Run, memberId: string, permission: 'edit' | 'view' | 'remove') {
  const { tx, ctx, scope, cr } = run;
  const me = requireEditor(ctx, scope, cr);
  requireStatus(cr, OPEN);
  requireSeen(run);
  const member = memberOf(scope, memberId);
  if (member.id === cr.author || member.id === cr.editor)
    throw new AppError('VALIDATION', `${member.name} already can edit #${cr.num}`);
  const row = and(
    eq(trackerCrShares.projectId, cr.projectId),
    eq(trackerCrShares.crId, cr.id),
    eq(trackerCrShares.memberId, member.id),
  );
  if (permission !== 'edit') await tx.delete(trackerCrAsks).where(askOf(cr, member.id));
  await touchCr(tx, cr);
  if (permission === 'remove') {
    await tx.delete(trackerCrShares).where(row);
    return;
  }
  const [current] = await tx
    .select({ permission: trackerCrShares.permission })
    .from(trackerCrShares)
    .where(row);
  if (current?.permission === permission) return;
  await tx
    .insert(trackerCrShares)
    .values({ ...scope.tenant, crId: cr.id, memberId: member.id, permission })
    .onConflictDoUpdate({
      target: [trackerCrShares.crId, trackerCrShares.memberId],
      set: { permission },
    });
  await addComment(tx, scope.tenant, {
    crId: cr.id,
    memberId: me.id,
    kind: 'shared',
    body: `${member.name} can ${permission}.`,
  });
}

async function comment(run: Run, body: string, opIndex: number | null) {
  const { tx, ctx, scope, cr } = run;
  const me = requireMember(ctx, scope.me);
  requireStatus(cr, OPEN);
  requireSeen(run);
  if (opIndex !== null && opIndex >= cr.ops.length)
    throw new AppError('VALIDATION', `#${cr.num} has no change ${opIndex}`);
  await touchCr(tx, cr);
  await addComment(tx, scope.tenant, {
    crId: cr.id,
    memberId: me.id,
    kind: 'comment',
    body,
    opIndex,
  });
}

const resolutionLine = (r: Resolution) =>
  `${r.label}: kept ${r.chose === 'main' ? `Main's version from #${r.from}` : 'this change request'}, "${r.chose === 'main' ? r.mainVal : r.crVal}".`;

async function merge(run: Run, picks: Record<string, 'main' | 'cr'>) {
  const { tx, ctx, scope, cr } = run;
  const me = requireOwner(ctx, scope);
  requireStatus(cr, ['ready']);
  requireSeen(run);
  const main = await loadMain(tx, scope);
  const tz = scope.tracker.timeZone;
  const clashes = clashesOf(cr.ops, main.commits);
  const keys = new Set(clashes.map((clash) => clash.key));
  const missing = [...keys].filter((key) => !picks[key]);
  const stale = Object.keys(picks).filter((key) => !keys.has(key));
  if (missing.length || stale.length)
    throw new AppError('CONFLICT', 'The clashes with Main changed. Review them again.', {
      details: { clashes: [...keys], missing, stale },
    });
  if (!liveOps(cr.ops, main.commits).length)
    throw new AppError('CONFLICT', `Main already has every change of #${cr.num}`);
  // A change that no longer applies stays out of Main, so Main never replays a skipped step.
  const ops = stillApplying(
    mainState(main.base, main.queue, main.commits),
    liveOps(cr.ops, main.commits, picks),
    tz,
  );
  const resolutions: Resolution[] = clashes.map((clash) => ({
    key: clash.key,
    label: clashLabel(clash, mainState(main.base, main.queue, main.commits, clash.x.rev)),
    chose: picks[clash.key],
    mainVal: clash.y.d?.after ?? '',
    crVal: clash.x.d?.after ?? '',
    from: clash.commit.crNum,
    by: me.id,
  }));
  const rev = mainRevision(main.commits) + 1;
  await tx.insert(trackerCommits).values({
    ...scope.tenant,
    rev,
    crId: cr.id,
    mergedBy: me.id,
    mergedAt: sql`now()`,
    ops,
    resolutions,
  });
  await updateCr(tx, cr, {
    status: 'merged',
    mergedRev: rev,
    mergedBy: me.id,
    mergedAt: sql`now()`,
    resolutions,
  });
  await tx.delete(trackerCrAsks).where(asksOf(cr));
  if (resolutions.length)
    await addComment(tx, scope.tenant, {
      crId: cr.id,
      memberId: me.id,
      kind: 'resolved',
      body: resolutions.map(resolutionLine).join('\n'),
    });
  await addComment(tx, scope.tenant, { crId: cr.id, memberId: me.id, kind: 'merged' });
}

async function requestChanges(run: Run, note: string) {
  const { tx, ctx, scope, cr } = run;
  const me = requireOwner(ctx, scope);
  requireStatus(cr, ['ready']);
  requireSeen(run);
  await updateCr(tx, cr, { status: 'draft' });
  await addComment(tx, scope.tenant, {
    crId: cr.id,
    memberId: me.id,
    kind: 'changes',
    body: note,
  });
}

async function close(run: Run) {
  const { tx, ctx, scope, cr } = run;
  const me = requireOwner(ctx, scope);
  requireStatus(cr, ['ready']);
  requireSeen(run);
  const commits = await loadCommits(tx, scope.project.id);
  await updateCr(tx, cr, {
    status: 'closed',
    closedBy: me.id,
    closedAt: sql`now()`,
    closedRev: mainRevision(commits),
  });
  await tx.delete(trackerCrAsks).where(asksOf(cr));
  await addComment(tx, scope.tenant, { crId: cr.id, memberId: me.id, kind: 'closed' });
}

function run(context: Run, input: Action): Promise<void> {
  switch (input.action) {
    case 'ready':
      return ready(context);
    case 'unready':
      return unready(context);
    case 'ask':
      return ask(context);
    case 'cancel-ask':
      return cancelAsk(context);
    case 'handover':
      return handover(context, input.to);
    case 'decline':
      return decline(context, input.who);
    case 'share':
      return share(context, input.memberId, input.permission);
    case 'comment':
      return comment(context, input.body, input.opIndex ?? null);
    case 'merge':
      return merge(context, input.picks);
    case 'request-changes':
      return requestChanges(context, input.note);
    case 'close':
      return close(context);
  }
}

export async function crAction(
  db: Db,
  ctx: ActorContext,
  raw: CrActionInput,
): Promise<TrackerPayload> {
  const input = parse(CrActionInputSchema, raw, 'Invalid change request action');
  return withTransaction(db, async (tx) => {
    const scope = await writeScope(tx, ctx, input.projectId, input.actAs);
    const cr = await lockCr(tx, scope.project.id, input.num);
    await run({ tx, ctx, scope, cr, expectedRevision: input.expectedRevision }, input);
    return buildPayload(tx, scope);
  });
}
