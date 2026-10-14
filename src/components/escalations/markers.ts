export type AnswerPart = { kind: 'text'; text: string } | { kind: 'act'; actId: string };
export type CitedActText = { label: string; quote: string | null };

// Same grammar the server accepts on save (lowercase UUID only); anything else stays visible as typed.
const MARKER = /\[act:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/g;

/** Answers are agent-written text: callers render the parts as text nodes and chips, never as HTML. */
export function renderMarkers(answer: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let at = 0;
  for (const match of answer.matchAll(MARKER)) {
    if (match.index > at) parts.push({ kind: 'text', text: answer.slice(at, match.index) });
    parts.push({ kind: 'act', actId: match[1] });
    at = match.index + match[0].length;
  }
  if (at < answer.length) parts.push({ kind: 'text', text: answer.slice(at) });
  return parts;
}

/** Copy and download carry the citations as numbered plain-text references, so the answer still reads correctly outside the app. */
export function answerPlainText(answer: string, acts: ReadonlyMap<string, CitedActText>): string {
  const numbers = new Map<string, number>();
  const body = renderMarkers(answer)
    .map((part) => {
      if (part.kind === 'text') return part.text;
      if (!acts.has(part.actId)) return `[act:${part.actId}]`;
      if (!numbers.has(part.actId)) numbers.set(part.actId, numbers.size + 1);
      return `[${numbers.get(part.actId)}]`;
    })
    .join('');
  if (!numbers.size) return body;
  const lines = [...numbers].map(([actId, number]) => {
    const { label, quote } = acts.get(actId)!;
    return `[${number}] ${label}${quote === null ? ' (quote unavailable)' : `: "${quote}"`}`;
  });
  return [body, '', 'Citations', ...lines].join('\n');
}
