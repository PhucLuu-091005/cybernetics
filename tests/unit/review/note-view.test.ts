import { describe, expect, it } from 'vitest';
import { noteView } from '../../../src/components/notes/note-view';

const A = '94f5c370-711a-4039-9e20-a02d1fd5e70d',
  B = 'fe8cb040-d525-4e8b-9009-a911e6098e6b',
  N = '94e84396-211b-4c56-95bb-1464890069cc';

describe('noteView', () => {
  it('numbers markers in reading order and reuses a number for a repeated act', () => {
    expect(
      noteView({ id: N, text: `x [act:${B}] y [act:${A}] z [act:${B}]`, actIds: [A, B] }),
    ).toEqual([
      { kind: 'text', text: 'x ' },
      { kind: 'cite', actId: B, n: 1 },
      { kind: 'text', text: ' y ' },
      { kind: 'cite', actId: A, n: 2 },
      { kind: 'text', text: ' z ' },
      { kind: 'cite', actId: B, n: 1 },
    ]);
  });
  it('lists actIds after the text when the note has no marker', () => {
    expect(noteView({ id: N, text: 'Plain.', actIds: [A, B] })).toEqual([
      { kind: 'text', text: 'Plain.' },
      { kind: 'text', text: ' ' },
      { kind: 'cite', actId: A, n: 1 },
      { kind: 'cite', actId: B, n: 2 },
    ]);
  });
  it('keeps a malformed marker as text', () => {
    expect(noteView({ id: N, text: 'See [act:ABC].', actIds: [A] })).toEqual([
      { kind: 'text', text: 'See [act:ABC].' },
      { kind: 'text', text: ' ' },
      { kind: 'cite', actId: A, n: 1 },
    ]);
  });
});
