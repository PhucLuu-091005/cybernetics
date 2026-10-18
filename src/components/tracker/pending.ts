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

export type Current = { state: TrackerState; marks?: Marks };

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

/** Changes made on one view can wait in a modal while a poll changes the view they go to. */
export function pendingMisfit(
  payload: TrackerPayload,
  target: 'main' | number,
  ops: readonly OpInput[],
): string | null {
  const cr = target === 'main' ? null : payload.crs.find((c) => c.num === target);
  if (cr === undefined) return `#${target} is gone, so nothing was added.`;
  if (fits(currentState(payload, cr).state, ops, payload.project.timeZone)) return null;
  return cr
    ? `That change no longer fits #${cr.num}, so nothing was added.`
    : 'That change no longer fits the latest Main, so no change request was made.';
}
