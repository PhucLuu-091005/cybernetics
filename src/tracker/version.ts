/**
 * The light read gives one short hash per part of the payload, joined with dots, so the browser can
 * name what changed without the full payload. Each part holds only what the viewer may see.
 */
const VERSION_PARTS = ['main', 'queue', 'crs', 'project'] as const;
type VersionPart = (typeof VERSION_PARTS)[number];
/** The change request on screen: a touch (ask, share, comment) moves only `updatedAt`. */
type CrMark = { num: number; revision: number; updatedAt: string };
/** `cr` is there when the check named a change request: null when the viewer cannot see it. */
export type TrackerVersion = { version: string; crCount: number; cr?: CrMark | null };

export const joinVersion = (parts: Record<VersionPart, string>) =>
  VERSION_PARTS.map((part) => parts[part]).join('.');

export function changedParts(shown: string, next: string): VersionPart[] {
  const a = shown.split('.'),
    b = next.split('.');
  return VERSION_PARTS.filter((_, i) => a[i] !== b[i]);
}
