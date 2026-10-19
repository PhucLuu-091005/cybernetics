import {
  crState,
  mainState,
  replayOps,
  type Cr,
  type Marks,
  type Op,
  type TrackerPayload,
  type TrackerState,
} from '../../tracker';
import type { OpInput } from './api';

type Current = { state: TrackerState; marks?: Marks };

export function currentState(payload: TrackerPayload, cr: Cr | null): Current {
  const main = () => ({ state: mainState(payload.base, payload.queue, payload.commits) });
  if (!cr) return main();
  // crState throws for a merged CR whose commit is not in this payload; show Main instead of a crash.
  if (cr.status === 'merged' && !payload.commits.some((c) => c.rev === cr.mergedRev)) return main();
  return crState(payload.base, payload.queue, payload.commits, cr, payload.project.timeZone);
}

/** An op that no longer fits the view the editor sees would come back as a 400; check it here first. */
export function fits(state: TrackerState, ops: readonly OpInput[], tz: string) {
  const replay = replayOps(
    state,
    ops.map((op) => ({ ...op, rev: 0, by: 'me' }) as Op),
    tz,
  );
  return replay.entries.every((e) => !e.skipped);
}
