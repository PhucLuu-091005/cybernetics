import { describe, expect, it } from 'vitest';
import { AnnotationSchema } from '../../../src/contracts';
import { markerErrors, noteParts } from '../../../src/contracts/markers';

const A = '94f5c370-711a-4039-9e20-a02d1fd5e70d',
  B = 'fe8cb040-d525-4e8b-9009-a911e6098e6b',
  C = '94e84396-211b-4c56-95bb-1464890069cc';

describe('noteParts', () => {
  it('returns plain text as one text part and nothing for an empty note', () => {
    expect(noteParts('Dear Sarah, thank you.')).toEqual([
      { kind: 'text', text: 'Dear Sarah, thank you.' },
    ]);
    expect(noteParts('')).toEqual([]);
  });
  it('splits text around markers, including markers at the start, at the end and next to each other', () => {
    expect(
      noteParts(
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
    expect(noteParts(`[act:${A}]`)).toEqual([{ kind: 'act', actId: A }]);
  });
  it('keeps malformed markers as plain text and merges them with the text around them', () => {
    const upper = `[act:${A.toUpperCase()}]`,
      short = '[act:94f5c370]',
      spaced = `[act: ${A}]`,
      open = `[act:${A}`;
    expect(noteParts(`a ${upper} b ${short} c ${spaced} d ${open}`)).toEqual([
      { kind: 'text', text: `a ${upper} b ${short} c ${spaced} d ${open}` },
    ]);
    expect(noteParts(`x [act:${A}] <b>y</b>`)).toEqual([
      { kind: 'text', text: 'x ' },
      { kind: 'act', actId: A },
      { kind: 'text', text: ' <b>y</b>' },
    ]);
  });
});

describe('markerErrors', () => {
  it('accepts markers that cite acts in actIds', () => {
    expect(markerErrors(`Late [act:${A}].`, [A])).toEqual([]);
  });
  it('rejects a marker outside actIds and a malformed marker', () => {
    expect(markerErrors(`Late [act:${B}].`, [A])).toEqual([`Marker [act:${B}] is not in actIds`]);
    expect(markerErrors('Late [act:ABC].', [A])).toEqual([
      'Note markers must be [act:<lowercase uuid>]',
    ]);
  });
  it('makes the annotation schema report the error on text', () => {
    const result = AnnotationSchema.safeParse({ id: C, text: `See [act:${B}]`, actIds: [A] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['text']);
  });
});
