import type { TrackerBase, TrackerQueue, TrackerState } from './model';
import { initialState, keysOf, replayOps, sameOp, type Op, type Replay } from './ops';
import type { Cr, QueueRow, Resolution } from './payload';
import { DEFAULT_TIME_ZONE } from './time';

export type Commit = {
  rev: number;
  crId: string;
  crNum: number;
  mergedBy: string;
  mergedAt: string;
  ops: Op[];
  resolutions: Resolution[];
};

export type Clash = { key: string; index: number; x: Op; y: Op; commit: Commit };

export type Picks = Record<string, 'main' | 'cr'>;

type QueueSource = readonly QueueRow[] | TrackerQueue;

const byRev = (commits: readonly Commit[]) => [...commits].sort((a, b) => a.rev - b.rev);

// A CR op only clashes with Main ops merged after the revision its editor saw.
export function newerOps(
  commits: readonly Commit[],
  fromRev: number,
): Array<{ y: Op; commit: Commit }> {
  return byRev(commits)
    .filter((commit) => commit.rev > fromRev)
    .flatMap((commit) => commit.ops.map((y) => ({ y, commit })));
}

export function clashesOf(crOps: readonly Op[], commits: readonly Commit[]): Clash[] {
  const clashes: Clash[] = [];
  crOps.forEach((x, index) => {
    const newer = newerOps(commits, x.rev);
    if (newer.some((n) => sameOp(n.y, x))) return;
    const keys = keysOf(x);
    const last = [...newer].reverse().find((n) => keysOf(n.y).some((k) => keys.includes(k)));
    if (!last) return;
    const key = keys.find((k) => keysOf(last.y).includes(k)) as string;
    clashes.push({ key, index, x, y: last.y, commit: last.commit });
  });
  return clashes;
}

export function liveOps(crOps: readonly Op[], commits: readonly Commit[], picks?: Picks): Op[] {
  const dropped = new Set(
    picks
      ? clashesOf(crOps, commits)
          .filter((clash) => picks[clash.key] === 'main')
          .map((clash) => clash.index)
      : [],
  );
  return crOps.filter(
    (x, index) => !dropped.has(index) && !newerOps(commits, x.rev).some((n) => sameOp(n.y, x)),
  );
}

export function mainState(
  base: TrackerBase,
  queue: QueueSource,
  commits: readonly Commit[],
  upto?: number,
): TrackerState {
  const ops = byRev(commits)
    .filter((commit) => upto === undefined || commit.rev <= upto)
    .flatMap((commit) => commit.ops);
  return replayOps(initialState(base, queue), ops).state;
}

export function crState(
  base: TrackerBase,
  queue: QueueSource,
  commits: readonly Commit[],
  cr: Pick<Cr, 'status' | 'ops' | 'mergedRev' | 'closedRev'>,
  timeZone: string = DEFAULT_TIME_ZONE,
): Replay {
  if (cr.status === 'merged') {
    const merge = commits.find((commit) => commit.rev === cr.mergedRev);
    if (!merge) throw new Error(`No commit for merged revision ${cr.mergedRev}`);
    const before = mainState(base, queue, commits, merge.rev - 1);
    return replayOps(before, merge.ops, timeZone);
  }
  if (cr.status === 'closed') {
    const at = mainState(base, queue, commits, cr.closedRev ?? undefined);
    return replayOps(at, cr.ops, timeZone);
  }
  return replayOps(mainState(base, queue, commits), liveOps(cr.ops, commits), timeZone);
}
