import { changedParts, type Cr, type TrackerVersion } from '../../tracker';

/** A merge changes Main and its change request together, so Main names that news. */
export function freshLabel(shown: TrackerVersion, next: TrackerVersion): string | null {
  if (next.version === shown.version) return null;
  const parts = changedParts(shown.version, next.version);
  if (parts.includes('main')) return 'Main changed';
  const mine = shown.cr,
    theirs = next.cr;
  if (
    parts.includes('crs') &&
    mine &&
    theirs !== undefined &&
    (theirs === null || theirs.revision !== mine.revision || theirs.updatedAt !== mine.updatedAt)
  )
    return 'This change request changed';
  if (parts.length !== 1) return 'New changes';
  if (parts[0] === 'queue') return 'The Queue changed';
  if (parts[0] !== 'crs') return 'New changes';
  const added = next.crCount - shown.crCount;
  if (added <= 0) return 'Change requests changed';
  return `${added} new change request${added === 1 ? '' : 's'}`;
}

/**
 * True when the draft on the server only has more changes after the ones on screen (the editor's
 * own agent appended), so an append may go on top of them; anything else needs Refresh.
 */
export function onlyAppended(shown: Cr, fresh: Cr | undefined): boolean {
  if (!fresh || fresh.status !== 'draft' || fresh.editor !== shown.editor) return false;
  if (fresh.ops.length <= shown.ops.length) return false;
  return shown.ops.every((op, i) => JSON.stringify(op) === JSON.stringify(fresh.ops[i]));
}
