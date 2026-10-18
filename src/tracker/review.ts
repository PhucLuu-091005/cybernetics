import {
  applyingCount,
  clashesOf,
  crVersionApplies,
  liveOps,
  mainState,
  type Clash,
  type Commit,
  type Picks,
} from './clash';
import { clashLabel } from './describe';
import type { TrackerEvent, TrackerQueue, TrackerState } from './model';
import { replayOps, sameOp, type Marks, type Op, type OpDescription, type Replay } from './ops';
import type { Cr, Resolution, TrackerPayload } from './payload';
import { can } from './permissions';

export type ReviewClash = Clash & {
  label: string;
  fromAuthor: string | null;
  mainVal: string;
  crVal: string;
  /** False when Main already took the spot, so a pick of the CR would merge nothing. */
  crApplies: boolean;
};

export type ReviewChange = {
  op: Op;
  /** Described against Before, so a clashing change shows Main's current value as its old value. */
  d: OpDescription;
  skipped: boolean;
  skipReason: SkipReason | null;
  /** The position in `cr.ops`, which per-change comments name. */
  opIndex: number | null;
  workItemId: string | null;
  title: string | null;
  milestoneId: string | null;
  event: TrackerEvent | null;
  clash: ReviewClash | null;
};

export type SkipReason = 'queue' | 'main' | 'removed' | 'skipped' | 'loop';

export const SKIP_REASON: Record<SkipReason, string> = {
  queue: 'The queue card was removed.',
  main: 'Main changed this spot after the change was made.',
  removed: 'It needs an earlier change that was removed.',
  skipped: 'It needs an earlier change that no longer applies.',
  loop: 'With the links Main has now, it would make a loop of parents and sources.',
};

export type ReviewModel = {
  cr: Cr;
  /** The viewer may merge, request changes and close. */
  merger: boolean;
  before: TrackerState;
  after: TrackerState;
  marks: Marks;
  changes: ReviewChange[];
  /** The changes that still apply: the count that the bar shows and Mark as ready needs. */
  applying: number;
  /** The positions of the changes that no longer apply, last first, so removing them one by one keeps the rest in place. */
  stale: number[];
  /** An open CR whose every change Main already took; it can only be cancelled. */
  inMain: boolean;
  clashes: ReviewClash[];
  /** The picks that match a clash now; the server rejects a merge that sends any other key. */
  picks: Picks;
  canMerge: boolean;
  dropped: Resolution[];
};

const isOpenCr = (cr: Cr) => cr.status === 'draft' || cr.status === 'ready';
const isMerger = (payload: TrackerPayload) => !!payload.me && can(payload, 'merge');

function eventIdOf(op: Op): string | null {
  switch (op.op) {
    case 'attach':
    case 'fromEvent':
    case 'move':
    case 'kind':
    case 'hide':
      return op.a.eventId;
    case 'addEvent':
      return op.a.ev.id;
    default:
      return null;
  }
}

function workItemIdOf(op: Op, after: TrackerState): string | null {
  switch (op.op) {
    case 'attach':
    case 'addEvent':
    case 'rename':
    case 'msRemove':
    case 'msAdd':
    case 'due':
    case 'doneBy':
    case 'requestedBy':
    case 'team':
    case 'parent':
    case 'after':
      return op.a.workItemId;
    case 'place':
    case 'qms':
      return op.a.itemId;
    case 'fromEvent':
      return op.a.id;
    case 'move':
      return op.a.to;
    case 'kind':
    case 'hide':
      return after.events.find((e) => e.id === op.a.eventId)?.workItemId ?? null;
    default:
      return null;
  }
}

function cardOf(op: Op): { kind: 'events' | 'items'; id: string } | null {
  if (op.op === 'attach' || op.op === 'fromEvent') return { kind: 'events', id: op.a.eventId };
  if (op.op === 'place' || op.op === 'qms') return { kind: 'items', id: op.a.itemId };
  return null;
}

function createdIds(op: Op): string[] {
  switch (op.op) {
    case 'attach':
      return [op.a.eventId];
    case 'place':
      return [op.a.itemId];
    case 'fromEvent':
      return [op.a.id, op.a.eventId];
    case 'addEvent':
      return [op.a.ev.id];
    case 'newMs':
    case 'addTeam':
      return [op.a.id];
    default:
      return [];
  }
}

const stringsIn = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(stringsIn)
      : [];

/** An op was admitted only while all it names existed, so a skip has one of these causes. */
function skipReasonOf(
  op: Op,
  mainTookIt: boolean,
  before: TrackerState,
  queue: TrackerQueue,
  earlierSkipped: readonly Op[],
): SkipReason {
  if (mainTookIt) return 'main';
  const card = cardOf(op);
  // The queue keeps the cards Main used, so a card that only Before lacks was used by Main.
  if (card && !before.queue[card.kind].some((q) => q.id === card.id))
    return queue[card.kind].some((q) => q.id === card.id) ? 'main' : 'queue';
  const gone = new Set(earlierSkipped.flatMap(createdIds));
  return stringsIn(op.a).some((id) => gone.has(id)) ? 'skipped' : 'removed';
}

/** A closed change request stops at its close, so only the Main commits up to it can have taken a spot. */
function closedClashIndexes(cr: Cr, commits: readonly Commit[]): Set<number> {
  if (cr.status !== 'closed') return new Set();
  const upto = cr.closedRev ?? Infinity;
  return new Set(
    clashesOf(
      cr.ops,
      commits.filter((c) => c.rev <= upto),
    ).map((clash) => clash.index),
  );
}

function milestoneIdOf(op: Op): string | null {
  if (op.op === 'msDate' || op.op === 'msName') return op.a.milestoneId;
  if (op.op === 'newMs') return op.a.id;
  return null;
}

/** Commit ops are copies with a fresh description, so they map back to the CR by content. */
function indexesIn(crOps: readonly Op[], ops: readonly Op[]): Array<number | null> {
  const used = new Set<number>();
  return ops.map((op) => {
    const index = crOps.findIndex((x, i) => !used.has(i) && sameOp(x, op));
    if (index < 0) return null;
    used.add(index);
    return index;
  });
}

type Shape = {
  before: TrackerState;
  ops: Op[];
  opIndexes: Array<number | null>;
  described: Replay;
  after: Replay;
};

function shapeOf(payload: TrackerPayload, cr: Cr, picks: Picks): Shape {
  const { base, queue, commits } = payload;
  const tz = payload.project.timeZone;
  const at = (before: TrackerState, ops: Op[], opIndexes: Array<number | null>): Shape => {
    const replay = replayOps(before, ops, tz);
    return { before, ops, opIndexes, described: replay, after: replay };
  };
  if (cr.status === 'merged') {
    const commit = commits.find((c) => c.rev === cr.mergedRev);
    if (!commit) return at(mainState(base, queue, commits), [], []);
    return at(
      mainState(base, queue, commits, commit.rev - 1),
      commit.ops,
      indexesIn(cr.ops, commit.ops),
    );
  }
  if (cr.status === 'closed')
    return at(
      mainState(base, queue, commits, cr.closedRev ?? undefined),
      cr.ops,
      cr.ops.map((_, i) => i),
    );
  const before = mainState(base, queue, commits);
  const live = liveOps(cr.ops, commits);
  return {
    before,
    ops: live,
    opIndexes: live.map((op) => cr.ops.indexOf(op)),
    described: replayOps(before, live, tz),
    after: replayOps(before, liveOps(cr.ops, commits, picks), tz),
  };
}

function reviewClashes(payload: TrackerPayload, cr: Cr): Array<Omit<ReviewClash, 'crApplies'>> {
  if (cr.status !== 'draft' && cr.status !== 'ready') return [];
  const { base, queue, commits, crs } = payload;
  return clashesOf(cr.ops, commits).map((clash) => ({
    ...clash,
    label: clashLabel(clash, mainState(base, queue, commits, clash.x.rev)),
    fromAuthor: crs.find((c) => c.id === clash.commit.crId)?.author ?? null,
    mainVal: clash.y.d?.after ?? '',
    crVal: clash.x.d?.after ?? '',
  }));
}

export function reviewModel(
  payload: TrackerPayload,
  num: number,
  picks: Picks = {},
): ReviewModel | null {
  const cr = payload.crs.find((c) => c.num === num);
  if (!cr) return null;
  const found = reviewClashes(payload, cr);
  const current: Picks = {};
  for (const clash of found) if (picks[clash.key]) current[clash.key] = picks[clash.key];
  const shape = shapeOf(payload, cr, current);
  const tz = payload.project.timeZone;
  const clashes: ReviewClash[] = found.map((clash) => ({
    ...clash,
    crApplies: crVersionApplies(shape.before, cr.ops, payload.commits, current, clash, tz),
  }));
  const after = shape.after.state;
  const closedClashes = closedClashIndexes(cr, payload.commits);
  const skippedOps: Op[] = [];
  const changes = shape.described.entries.map(({ i, skipped, loop, ...d }): ReviewChange => {
    const op = shape.ops[i];
    const opIndex = shape.opIndexes[i];
    const workItemId = workItemIdOf(op, after);
    const eventId = eventIdOf(op);
    const clash = clashes.find((k) => k.index === opIndex) ?? null;
    const mainTookIt = !!clash || (opIndex !== null && closedClashes.has(opIndex));
    const skipReason = !skipped
      ? null
      : loop && !mainTookIt
        ? 'loop'
        : skipReasonOf(op, mainTookIt, shape.before, payload.queue, skippedOps);
    if (skipped) skippedOps.push(op);
    return {
      op,
      d,
      skipped: !!skipped,
      skipReason,
      opIndex,
      workItemId,
      title: after.workItems.find((w) => w.id === workItemId)?.title ?? null,
      milestoneId: milestoneIdOf(op),
      event: (eventId && after.events.find((e) => e.id === eventId)) || null,
      clash,
    };
  });
  const merger = isMerger(payload);
  return {
    cr,
    merger,
    before: shape.before,
    after,
    marks: shape.after.marks,
    changes,
    applying: applyingCount(shape.described),
    inMain: isOpenCr(cr) && cr.ops.length > 0 && shape.ops.length === 0,
    stale: changes
      .flatMap((change) => (change.skipReason && change.opIndex !== null ? [change.opIndex] : []))
      .sort((a, b) => b - a),
    clashes,
    picks: current,
    canMerge:
      cr.status === 'ready' &&
      merger &&
      shape.after.entries.some((entry) => !entry.skipped) &&
      !changes.some((change) => change.skipReason === 'loop') &&
      clashes.every(
        (clash) =>
          current[clash.key] === 'main' || (current[clash.key] === 'cr' && clash.crApplies),
      ),
    dropped: cr.status === 'merged' ? cr.resolutions.filter((r) => r.chose === 'main') : [],
  };
}

/**
 * A merger merges what they reviewed, so the review keeps the opened revision of the change request
 * until they review again. Comments, asks and shares do not change the revision and stay live.
 * Other viewers decide nothing on that revision, so they always see the live change request.
 */
export function openedReview(
  live: TrackerPayload,
  opened: Cr | null,
): { payload: TrackerPayload; changed: boolean } {
  const now = opened && live.crs.find((c) => c.num === opened.num);
  if (!isMerger(live) || !opened || !now || now.revision === opened.revision)
    return { payload: live, changed: false };
  const kept: Cr = {
    ...opened,
    comments: now.comments,
    asks: now.asks,
    shares: now.shares,
    updatedAt: now.updatedAt,
  };
  return { payload: { ...live, crs: live.crs.map((c) => (c === now ? kept : c)) }, changed: true };
}
