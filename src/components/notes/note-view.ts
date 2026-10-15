import { noteParts, type Annotation } from '../../contracts';

export type CitePart = { kind: 'text'; text: string } | { kind: 'cite'; actId: string; n: number };

function citeParts(text: string, actIds: readonly string[]): CitePart[] {
  const numbers = new Map<string, number>();
  const number = (actId: string) => {
    if (!numbers.has(actId)) numbers.set(actId, numbers.size + 1);
    return numbers.get(actId)!;
  };
  const parts: CitePart[] = noteParts(text).map((part) =>
    part.kind === 'text' ? part : { kind: 'cite', actId: part.actId, n: number(part.actId) },
  );
  if (numbers.size === 0 && actIds.length) {
    parts.push({ kind: 'text', text: ' ' });
    for (const actId of actIds) parts.push({ kind: 'cite', actId, n: number(actId) });
  }
  return parts;
}

export const noteView = (note: Annotation): CitePart[] => citeParts(note.text, note.actIds);

/** Plain text for a table cell, where a cite has no click target: "[1]" stands for the step. */
export const noteText = (text: string, actIds: readonly string[] = []): string =>
  citeParts(text, actIds)
    .map((part) => (part.kind === 'text' ? part.text : `[${part.n}]`))
    .join('');
