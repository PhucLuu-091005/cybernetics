export const ACT_MARKER = /\[act:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/g;
const MARKER_OPEN = '[act:';

export type NotePart = { kind: 'text'; text: string } | { kind: 'act'; actId: string };

/** Notes are agent-written: callers render the parts as text nodes and buttons, never as HTML. */
export function noteParts(text: string): NotePart[] {
  const parts: NotePart[] = [];
  let at = 0;
  for (const match of text.matchAll(ACT_MARKER)) {
    if (match.index > at) parts.push({ kind: 'text', text: text.slice(at, match.index) });
    parts.push({ kind: 'act', actId: match[1] });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) });
  return parts;
}

export function markerErrors(text: string, actIds: readonly string[]): string[] {
  const markers = [...text.matchAll(ACT_MARKER)];
  const errors: string[] = [];
  if (markers.length !== text.split(MARKER_OPEN).length - 1)
    errors.push('Note markers must be [act:<lowercase uuid>]');
  const cited = new Set(actIds);
  for (const match of markers)
    if (!cited.has(match[1])) errors.push(`Marker ${match[0]} is not in actIds`);
  return errors;
}
