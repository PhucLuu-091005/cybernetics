import { describe, expect, it } from 'vitest';
import type { Annotation, Conflict, Loop } from '../../../src/contracts';
import {
  conflictSentence,
  describeEntity,
  fieldLines,
  summarizeEntity,
  type Names,
} from '../../../src/components/review/describe';

const TOM = 'fa2faaea-0f39-44b1-94fe-e65c0a102e7f',
  QUANG = '8a4b6eb7-d431-4929-99c8-a19a3d30ab43';
const SUPPORT = '5b0c6d3e-0000-4000-8000-000000000001',
  ENGINEERING = '5b0c6d3e-0000-4000-8000-000000000002';
const names: Names = {
  people: { [TOM]: 'Tom Becker', [QUANG]: 'Quang Nguyễn' },
  loops: {},
  milestones: {},
  departments: { [SUPPORT]: 'Support', [ENGINEERING]: 'Engineering' },
  records: {},
};
const loop = (overrides: Partial<Loop>) =>
  ({
    id: 'fd3d4b6e-0000-4000-8000-000000000001',
    title: 'Renew the secret',
    customer: { kind: 'person', personId: QUANG },
    performer: { kind: 'person', personId: TOM },
    performerDepartmentId: SUPPORT,
    ...overrides,
  }) as unknown as Loop;

describe('fieldLines party labels', () => {
  it('says requested by, done by and department, like the screens', () => {
    const before = loop({});
    const after = loop({
      customer: { kind: 'person', personId: TOM },
      performer: { kind: 'person', personId: QUANG },
      performerDepartmentId: ENGINEERING,
    });
    const [beforeLines, afterLines] = fieldLines('loops', [before, after], names);
    expect(beforeLines.map((line) => [line.label, line.value])).toEqual([
      ['requested by', 'Quang Nguyễn'],
      ['done by', 'Tom Becker'],
      ['department', 'Support'],
    ]);
    expect(afterLines.map((line) => [line.label, line.value])).toEqual([
      ['requested by', 'Tom Becker'],
      ['done by', 'Quang Nguyễn'],
      ['department', 'Engineering'],
    ]);
  });
});

describe('a note in a change set', () => {
  const ACT_A = '94f5c370-711a-4039-9e20-a02d1fd5e70d',
    ACT_B = 'fe8cb040-d525-4e8b-9009-a911e6098e6b';
  const long = 'The fund closed on 12 September after the documents arrived late. '.repeat(4);
  const note = (text: string, actIds = [ACT_A, ACT_B]) =>
    ({ id: 'fd3d4b6e-0000-4000-8000-0000000000aa', text, actIds }) as Annotation;
  const marked = note(`${long}See [act:${ACT_B}] and [act:${ACT_A}].`);

  it('shows the full note with numbered cites in the table summary', () => {
    const summary = summarizeEntity('annotations', marked, names);
    expect(summary).toBe(`${long}See [1] and [2].`);
    expect(summary).not.toContain('[act:');
    expect(summary.length).toBeGreaterThan(160);
  });

  it('shows a numbered cite, not a raw marker, in the title', () => {
    const early = note(`Closed on 12 September [act:${ACT_A}] after a delay.`);
    expect(describeEntity('annotations', early.id, early, names).name).toBe(
      'Closed on 12 September [1] after a delay.',
    );
  });

  it('shows no raw marker in a changed note and counts cited steps', () => {
    const after = note(`Short [act:${ACT_A}].`, [ACT_A]);
    const [beforeLines, afterLines] = fieldLines('annotations', [marked, after], names);
    expect(beforeLines).toEqual([
      { field: 'text', label: 'text', value: `${long}See [1] and [2].` },
      { field: 'actIds', label: 'cited steps', value: '2' },
    ]);
    expect(afterLines).toEqual([
      { field: 'text', label: 'text', value: 'Short [1].' },
      { field: 'actIds', label: 'cited steps', value: '1' },
    ]);
  });
});

describe('conflictSentence', () => {
  const conflict = (overrides: Partial<Conflict>) =>
    ({
      collection: 'acts',
      id: 'fd3d4b6e-0000-4000-8000-0000000000bb',
      base: {},
      main: {},
      proposed: {},
      reason:
        'Current entity differs from the target commit postimage; resolve the inverse explicitly.',
      ...overrides,
    }) as unknown as Conflict;

  it('says a later change edited the item and what undo does, without the API reason', () => {
    const sentence = conflictSentence(conflict({}));
    expect(sentence).toBe('A later change edited this item. Undo would overwrite it.');
    expect(sentence).not.toMatch(/revert|entity|postimage|inverse/i);
  });

  it('says a later change removed the item', () => {
    expect(conflictSentence(conflict({ main: null }))).toBe('A later change removed this item.');
  });
});
