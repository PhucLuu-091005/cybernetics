import type { Conflict, GraphSnapshot, RebaseResult } from '../../contracts/graph';
import type { ConflictResolution } from '../../contracts/proposals';
import { canonicalJson } from '../../lib/canonical-json';
import { diffSnapshots } from './diff';
import { applyChange, compositionConflicts, entityAt, threeWayRebase } from './rebase';

const key = (value: { collection: string; id: string }) => `${value.collection}/${value.id}`;

export function resolveRebase(base: GraphSnapshot, candidate: GraphSnapshot, main: GraphSnapshot,
  resolutions: ConflictResolution[]): RebaseResult {
  const preview = threeWayRebase(base, candidate, main);
  const open = new Map(preview.conflicts.map(conflict => [key(conflict), conflict]));
  const chosen = new Map(resolutions.map(resolution => [key(resolution), resolution]));
  const problems: Conflict[] = [
    ...[...open.values()].filter(conflict => !chosen.has(key(conflict)))
      .map(conflict => ({ ...conflict, reason: `Resolution missing. ${conflict.reason}` })),
    ...resolutions.filter(resolution => !open.has(key(resolution))).map(resolution => ({
      collection: resolution.collection, id: resolution.id, base: null, main: null, proposed: null,
      reason: 'No such conflict in the current rebase preview.' })),
  ];
  if (problems.length) return { snapshot: null, conflicts: problems };

  const snapshot = structuredClone(main);
  const proposedChanges = diffSnapshots(base, candidate).changes;
  for (const change of proposedChanges) {
    const resolution = chosen.get(key(change));
    if (!resolution) {
      const current = entityAt(main, change.collection, change.id), before = entityAt(base, change.collection, change.id);
      if (canonicalJson(current) === canonicalJson(before)) applyChange(snapshot, change);
      continue;
    }
    if (resolution.choice === 'proposal') applyChange(snapshot, change);
    if (resolution.choice === 'replacement') applyChange(snapshot, { collection: change.collection, id: change.id,
      kind: resolution.value === null ? 'removed' : 'changed', before: change.before, after: resolution.value });
  }
  const invalid = compositionConflicts(snapshot, base, candidate, main,
    [...proposedChanges, ...diffSnapshots(base, main).changes]);
  return invalid.length ? { snapshot: null, conflicts: invalid } : { snapshot, conflicts: [] };
}
