import { describe, expect, it } from 'vitest';
import {
  loopColor,
  problemCounts,
  problemTone,
  TONE_COLOR,
} from '../../../src/components/graph/labels';
import type { DerivedLoop } from '../../../src/contracts/engine';

type Breakdown = DerivedLoop['breakdowns'][number];

const late: Breakdown = {
  type: 'late_delivery',
  severity: 'broken',
  loopId: '00000000-0000-4000-8000-000000000001',
  proofActIds: ['00000000-0000-4000-8000-000000000002'],
  sentence: 'Late.',
  startAt: '2026-07-10T00:00:00Z',
  endAt: '2026-07-24T00:00:00Z',
  businessDays: 10,
};
const loop = (state: DerivedLoop['state'], breakdowns: Breakdown[] = [late]) =>
  ({ state, breakdowns, dueSoon: false }) as unknown as DerivedLoop;

describe('past problems', () => {
  it('colours a finished loop by its end, whatever happened before', () => {
    expect(loopColor(loop('closed'))).toBe(TONE_COLOR.green);
    expect(loopColor(loop('declined'))).toBe(TONE_COLOR.gray);
    expect(loopColor(loop('cancelled'))).toBe(TONE_COLOR.gray);
    expect(loopColor(loop('promised'))).toBe(TONE_COLOR.red);
  });

  it('keeps the colour of an open loop without a problem', () => {
    expect(loopColor(loop('promised', []))).toBe(TONE_COLOR.blue);
    expect(loopColor(loop('promised', [{ ...late, severity: 'warning' }]))).toBe(TONE_COLOR.amber);
  });

  it('marks a problem on a finished loop as past', () => {
    expect(problemTone(loop('closed'), late)).toBe('past');
    expect(problemTone(loop('declined'), late)).toBe('past');
    expect(problemTone(loop('cancelled'), late)).toBe('past');
    expect(problemTone(loop('promised'), late)).toBe('broken');
    expect(problemTone(loop('promised'), { ...late, severity: 'warning' })).toBe('warning');
  });

  it('counts only current problems as broken or warning', () => {
    expect(
      problemCounts([
        loop('closed'),
        loop('promised'),
        loop('delivered', [{ ...late, severity: 'warning' }]),
        loop('promised', []),
      ]),
    ).toEqual({ broken: 1, warning: 1, past: 1 });
  });

  it('counts a loop once even when it has several problems', () => {
    const rejected: Breakdown = { ...late, type: 'rejected_delivery' };
    expect(
      problemCounts([loop('promised', [late, rejected]), loop('closed', [late, rejected])]),
    ).toEqual({
      broken: 1,
      warning: 0,
      past: 1,
    });
  });
});
