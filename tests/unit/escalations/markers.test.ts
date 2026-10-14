import { describe, expect, it } from 'vitest';
import { answerPlainText, renderMarkers } from '../../../src/components/escalations/markers';

const A = '94f5c370-711a-4039-9e20-a02d1fd5e70d',
  B = 'fe8cb040-d525-4e8b-9009-a911e6098e6b',
  C = '94e84396-211b-4c56-95bb-1464890069cc';

describe('renderMarkers', () => {
  it('returns plain text as one text part and nothing for an empty answer', () => {
    expect(renderMarkers('Dear Sarah, thank you.')).toEqual([
      { kind: 'text', text: 'Dear Sarah, thank you.' },
    ]);
    expect(renderMarkers('')).toEqual([]);
  });
  it('splits text around markers, including markers at the start, at the end and next to each other', () => {
    expect(
      renderMarkers(
        `We promised 30 September [act:${A}] and told you on 12 September [act:${B}][act:${C}].`,
      ),
    ).toEqual([
      { kind: 'text', text: 'We promised 30 September ' },
      { kind: 'act', actId: A },
      { kind: 'text', text: ' and told you on 12 September ' },
      { kind: 'act', actId: B },
      { kind: 'act', actId: C },
      { kind: 'text', text: '.' },
    ]);
    expect(renderMarkers(`[act:${A}]`)).toEqual([{ kind: 'act', actId: A }]);
  });
  it('keeps malformed markers as plain text and merges them with the text around them', () => {
    const upper = `[act:${A.toUpperCase()}]`,
      short = '[act:94f5c370]',
      spaced = `[act: ${A}]`,
      open = `[act:${A}`;
    expect(renderMarkers(`a ${upper} b ${short} c ${spaced} d ${open}`)).toEqual([
      { kind: 'text', text: `a ${upper} b ${short} c ${spaced} d ${open}` },
    ]);
    expect(renderMarkers(`x [act:${A}] <b>y</b>`)).toEqual([
      { kind: 'text', text: 'x ' },
      { kind: 'act', actId: A },
      { kind: 'text', text: ' <b>y</b>' },
    ]);
  });
});

describe('answerPlainText', () => {
  const acts = new Map([
    [A, { label: 'Minh Trần, 3 Jul 2026, promise', quote: 'go live by 30 September' }],
    [B, { label: 'Minh Trần, 12 Sep 2026, renegotiate', quote: null }],
  ]);
  it('numbers resolved citations by first use and lists them after the answer', () => {
    expect(
      answerPlainText(`Promised [act:${A}], moved [act:${B}], promised again [act:${A}].`, acts),
    ).toBe(
      [
        'Promised [1], moved [2], promised again [1].',
        '',
        'Citations',
        '[1] Minh Trần, 3 Jul 2026, promise: "go live by 30 September"',
        '[2] Minh Trần, 12 Sep 2026, renegotiate (quote unavailable)',
      ].join('\n'),
    );
  });
  it('leaves an unknown act marker as its literal text and adds no citation list without resolved citations', () => {
    expect(answerPlainText(`Unknown [act:${C}].`, acts)).toBe(`Unknown [act:${C}].`);
  });
});
