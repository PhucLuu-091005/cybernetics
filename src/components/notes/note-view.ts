import { noteParts, type Annotation } from '../../contracts';

export type CitePart = { kind: 'text'; text: string } | { kind: 'cite'; actId: string; n: number };

export function noteView(note: Annotation): CitePart[] {
  const numbers = new Map<string, number>();
  const number = (actId: string) => {
    if (!numbers.has(actId)) numbers.set(actId, numbers.size + 1);
    return numbers.get(actId)!;
  };
  const parts: CitePart[] = noteParts(note.text).map((part) =>
    part.kind === 'text' ? part : { kind: 'cite', actId: part.actId, n: number(part.actId) },
  );
  if (numbers.size === 0 && note.actIds.length) {
    parts.push({ kind: 'text', text: ' ' });
    for (const actId of note.actIds) parts.push({ kind: 'cite', actId, n: number(actId) });
  }
  return parts;
}
