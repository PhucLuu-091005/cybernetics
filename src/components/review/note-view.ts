import { noteParts } from '../../contracts';

/** Plain text for a table cell, where a cite has no click target: "[1]" stands for the step. */
export function noteText(text: string, actIds: readonly string[] = []): string {
  const numbers = new Map<string, number>();
  const cite = (actId: string) => {
    if (!numbers.has(actId)) numbers.set(actId, numbers.size + 1);
    return `[${numbers.get(actId)}]`;
  };
  const body = noteParts(text)
    .map((part) => (part.kind === 'text' ? part.text : cite(part.actId)))
    .join('');
  return numbers.size === 0 && actIds.length ? `${body} ${actIds.map(cite).join('')}` : body;
}
