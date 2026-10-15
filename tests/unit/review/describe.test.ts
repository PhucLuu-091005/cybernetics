import { describe, expect, it } from 'vitest';
import type { Loop } from '../../../src/contracts';
import { fieldLines, type Names } from '../../../src/components/review/describe';

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
