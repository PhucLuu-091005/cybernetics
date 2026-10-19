/**
 * The light read gives one short hash per part of the payload, joined with dots, so the browser can
 * name what changed without the full payload. Each part holds only what the viewer may see.
 */
export const VERSION_PARTS = ['main', 'queue', 'crs', 'project'] as const;
export type VersionPart = (typeof VERSION_PARTS)[number];
export type TrackerVersion = { version: string; crCount: number };

export const joinVersion = (parts: Record<VersionPart, string>) =>
  VERSION_PARTS.map((part) => parts[part]).join('.');

export function changedParts(shown: string, next: string): VersionPart[] {
  const a = shown.split('.'),
    b = next.split('.');
  return VERSION_PARTS.filter((_, i) => a[i] !== b[i]);
}
