import { isUtf16Boundary } from '../contracts/primitives';

export type QuoteContext = { before: string; after: string };

/** SRD 7.4: up to `budget` characters around a quote, split evenly; a short side lends its unused share to the other, and no cut splits a surrogate pair. */
export function quoteContext(body: string, start: number, end: number, budget = 300): QuoteContext {
  const half = Math.floor(budget / 2);
  let from = start - Math.min(start, budget - Math.min(half, body.length - end));
  while (!isUtf16Boundary(body, from)) from++;
  let to = end + Math.min(body.length - end, budget - (start - from));
  while (!isUtf16Boundary(body, to)) to--;
  return { before: body.slice(from, start), after: body.slice(end, to) };
}
