import { changedParts, type TrackerVersion } from '../../tracker';

/** A merge changes Main and its change request together, so Main names that news. */
export function freshLabel(shown: TrackerVersion, next: TrackerVersion): string | null {
  if (next.version === shown.version) return null;
  const parts = changedParts(shown.version, next.version);
  if (parts.includes('main')) return 'Main changed';
  if (parts.length !== 1) return 'New changes';
  if (parts[0] === 'queue') return 'The Queue changed';
  if (parts[0] !== 'crs') return 'New changes';
  const added = next.crCount - shown.crCount;
  if (added <= 0) return 'Change requests changed';
  return `${added} new change request${added === 1 ? '' : 's'}`;
}
