import { describe, expect, it } from 'vitest';
import { deriveVerdict } from '../../../src/server/domain/escalations/verdict';
const claim = (supporting: string[], contradicting: string[]) => ({
  id: crypto.randomUUID(),
  text: 'c',
  type: 't',
  timeWindow: null,
  supportingActIds: supporting,
  contradictingActIds: contradicting,
  openQuestions: [],
});
describe('deriveVerdict', () => {
  it('maps citation sets to verdicts', () => {
    const a = crypto.randomUUID(),
      b = crypto.randomUUID();
    expect([
      deriveVerdict(claim([a], [])),
      deriveVerdict(claim([], [b])),
      deriveVerdict(claim([a], [b])),
      deriveVerdict(claim([], [])),
    ]).toEqual(['supported', 'contradicted', 'contested', 'insufficient']);
  });
});
