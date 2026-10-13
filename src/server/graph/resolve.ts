import type { Conflict, GraphSnapshot, RebaseResult } from '../../contracts/graph';
import type { ConflictResolution } from '../../contracts/proposals';
import { canonicalJson } from '../../lib/canonical-json';
import { diffSnapshots } from './diff';
import { applyChange, compositionConflicts, entityAt, threeWayRebase } from './rebase';

type Image = ReturnType<typeof entityAt>;

const key = (value: { collection: string; id: string }) => `${value.collection}/${value.id}`;

function identityOf(resolution: ConflictResolution): string | null {
  if (resolution.choice !== 'replacement' || resolution.value === null) return resolution.id;
  const value = resolution.value as unknown as Record<string, unknown>;
  if (resolution.collection === 'context') return resolution.id;
  const identity = resolution.collection === 'recordDecisions' ? value.recordVersionId : value.id;
  return typeof identity === 'string' ? identity : null;
}

export function resolveRebase(base: GraphSnapshot, candidate: GraphSnapshot, main: GraphSnapshot,
  resolutions: ConflictResolution[]): RebaseResult {
  const preview = threeWayRebase(base, candidate, main);
  const open = new Map(preview.conflicts.map(conflict => [key(conflict), conflict]));
  const unmatched = (resolution: ConflictResolution, reason: string): Conflict => ({
    collection: resolution.collection, id: resolution.id, base: null, main: null, proposed: null, reason });

  const chosen = new Map<string, ConflictResolution>();
  const problems: Conflict[] = [];
  for (const resolution of resolutions) {
    const resolutionKey = key(resolution);
    if (chosen.has(resolutionKey)) {
      problems.push(open.get(resolutionKey) ? { ...open.get(resolutionKey)!, reason: 'Duplicate resolution for this conflict.' }
        : unmatched(resolution, 'Duplicate resolution for this conflict.'));
      continue;
    }
    chosen.set(resolutionKey, resolution);
    if (identityOf(resolution) !== resolution.id) problems.push(open.get(resolutionKey)
      ? { ...open.get(resolutionKey)!, reason: "Replacement value must keep the conflict's entity identity." }
      : unmatched(resolution, "Replacement value must keep the conflict's entity identity."));
  }
  for (const conflict of open.values()) {
    if (!chosen.has(key(conflict))) problems.push({ ...conflict, reason: `Resolution missing. ${conflict.reason}` });
  }
  if (problems.length) return { snapshot: null, conflicts: problems };

  const snapshot = structuredClone(main);
  const proposedChanges = diffSnapshots(base, candidate).changes;
  const proposedKeys = new Set(proposedChanges.map(key));
  for (const change of proposedChanges) {
    if (open.has(key(change))) continue;
    const current = entityAt(main, change.collection, change.id), before = entityAt(base, change.collection, change.id);
    if (canonicalJson(current) === canonicalJson(before)) applyChange(snapshot, change);
  }

  const place = (resolution: ConflictResolution) => {
    const { collection, id } = resolution;
    const image: Image = resolution.choice === 'main' ? entityAt(main, collection, id)
      : resolution.choice === 'proposal' ? entityAt(candidate, collection, id) : (resolution as { value: Image }).value;
    applyChange(snapshot, { collection, id, kind: image === null && collection !== 'context' ? 'removed' : 'changed',
      before: entityAt(proposedKeys.has(key(resolution)) ? base : main, collection, id), after: image } as never);
  };
  const allChanges = [...proposedChanges, ...diffSnapshots(base, main).changes];
  const applied = new Set<string>();
  for (const resolution of chosen.values()) {
    if (open.has(key(resolution))) { place(resolution); applied.add(key(resolution)); }
  }
  let invalid = compositionConflicts(snapshot, base, candidate, main, allChanges);
  const late = invalid.map(conflict => chosen.get(key(conflict)))
    .filter((resolution): resolution is ConflictResolution => !!resolution && !applied.has(key(resolution)));
  if (late.length) {
    for (const resolution of late) { place(resolution); applied.add(key(resolution)); }
    invalid = compositionConflicts(snapshot, base, candidate, main, allChanges);
  }
  const unused = [...chosen.values()].filter(resolution => !applied.has(key(resolution)))
    .map(resolution => unmatched(resolution, 'No such conflict in the current rebase preview.'));
  if (unused.length) {
    const seen = new Set(unused.map(key));
    return { snapshot: null, conflicts: [...unused, ...invalid.filter(conflict => !seen.has(key(conflict)))] };
  }
  return invalid.length ? { snapshot: null, conflicts: invalid } : { snapshot, conflicts: [] };
}
