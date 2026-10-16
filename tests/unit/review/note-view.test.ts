import { describe, expect, it } from 'vitest';
import { noteText } from '../../../src/components/review/note-view';

const A = '94f5c370-711a-4039-9e20-a02d1fd5e70d',
  B = 'fe8cb040-d525-4e8b-9009-a911e6098e6b';

describe('noteText', () => {
  it('numbers markers in reading order and reuses a number for a repeated act', () => {
    expect(noteText(`x [act:${B}] y [act:${A}] z [act:${B}]`, [A, B])).toBe('x [1] y [2] z [1]');
  });
  it('lists actIds after the text when the note has no marker', () => {
    expect(noteText('Plain.', [A, B])).toBe('Plain. [1][2]');
  });
  it('keeps a malformed marker as text', () => {
    expect(noteText('See [act:ABC].', [A])).toBe('See [act:ABC]. [1]');
  });
});
