import { MAX_SUMMARY_KEYS, type Conflict, type ConflictSummary, type DiffSummary, type SnapshotDiff } from '../../contracts';

export function summarizeDiff(diff: SnapshotDiff): DiffSummary {
  const summary: DiffSummary = { total: diff.changes.length, counts: {}, added: [], removed: [], changed: [] };
  for (const change of diff.changes) {
    const counts = summary.counts[change.collection] ??= { added: 0, removed: 0, changed: 0 };
    counts[change.kind]++;
    if (summary[change.kind].length < MAX_SUMMARY_KEYS) summary[change.kind].push(`${change.collection}/${change.id}`);
  }
  return summary;
}

export function summarizeConflicts(conflicts: readonly Conflict[]): ConflictSummary {
  return { conflictCount: conflicts.length, conflicts: conflicts.slice(0, MAX_SUMMARY_KEYS).map(({ collection, id, reason }) => ({ collection, id, reason })) };
}

export function withDiffSummary<T extends { diff: SnapshotDiff; conflicts?: readonly Conflict[] }>(value: T): Omit<T, 'diff' | 'conflicts'> & { diffSummary: DiffSummary } & Partial<ConflictSummary> {
  const { diff, conflicts, ...rest } = value;
  return { ...rest, diffSummary: summarizeDiff(diff), ...(conflicts ? summarizeConflicts(conflicts) : {}) };
}
