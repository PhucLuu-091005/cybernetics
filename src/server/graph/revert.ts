import type { Conflict, GraphSnapshot, InverseResult } from '../../contracts/graph';
import { diffSnapshots } from './diff';
import { applyChange, threeWayRebase } from './rebase';

/** Strict inverse: even a later edit back to the parent is a postimage mismatch. */
export function inverseCommit(
  parent: GraphSnapshot,
  target: GraphSnapshot,
  main: GraphSnapshot,
): InverseResult {
  const delta = diffSnapshots(parent, target).changes;
  const laterChanges = new Map(
    diffSnapshots(target, main).changes.map((change) => [
      `${change.collection}/${change.id}`,
      change,
    ]),
  );
  const conflicts: Conflict[] = [];
  for (const change of delta) {
    const later = laterChanges.get(`${change.collection}/${change.id}`);
    if (later)
      conflicts.push({
        collection: change.collection,
        id: change.id,
        base: change.after,
        main: later.after,
        proposed: change.before,
        reason:
          'Current entity differs from the target commit postimage; resolve the inverse explicitly.',
      });
  }
  if (conflicts.length) {
    const blocked = new Set(conflicts.map((conflict) => `${conflict.collection}/${conflict.id}`));
    const proposed = structuredClone(main);
    for (const change of delta) {
      if (blocked.has(`${change.collection}/${change.id}`)) continue;
      applyChange(proposed, {
        ...change,
        before: change.after,
        after: change.before,
        kind: change.before === null ? 'removed' : 'changed',
      });
    }
    return { snapshot: proposed, conflicts };
  }
  // The strict check above makes this ordinary composition safe only for touched entities.
  // Rebase also checks references created by unrelated later work before exposing a snapshot.
  return threeWayRebase(target, parent, main);
}
