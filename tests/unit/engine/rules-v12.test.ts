import { describe, expect, it } from 'vitest';
import { deriveProject, EngineInputError } from '../../../src/server/loops/engine';
import { fixture, loop, types } from '../../support/engine-builders';

const at = (day: number) => `2026-10-${day.toString().padStart(2, '0')}T12:00:00Z`;

describe('SRD v1.2 engine rules', () => {
  it('raises silent_overdue when an agreed new date passes without delivery', () => {
    const input = fixture([
      { type: 'promise', due: { date: '2026-10-09', precision: 'day' }, at: at(5) },
      { type: 'renegotiate', due: { date: '2026-10-20', precision: 'day' }, at: at(6) },
      { type: 'agree_change', at: at(7) },
    ], '2026-10-23T12:00:00Z');
    expect(loop(input).due).toEqual({ date: '2026-10-20', precision: 'day' });
    expect(types(input)).toContain('silent_overdue');
  });
  it('keeps the renegotiate notice protection for the original date only', () => {
    const input = fixture([
      { type: 'promise', due: { date: '2026-10-09', precision: 'day' }, at: at(5) },
      { type: 'renegotiate', due: { date: '2026-10-20', precision: 'day' }, at: at(6) },
    ], '2026-10-12T12:00:00Z');
    expect(types(input)).not.toContain('silent_overdue');
  });
  it('accepts a firm repeated promise with different wording and clears hedged', () => {
    const input = fixture([
      { type: 'request', at: at(1) },
      { type: 'promise', hedged: true, action: 'look into the sync', at: at(2) },
      { type: 'promise', hedged: false, action: 'build the Dynamics sync', at: at(5) },
    ], '2026-10-16T12:00:00Z');
    expect(loop(input).hedged).toBe(false);
    expect(loop(input).acts.flatMap(act => act.flags)).toEqual([]);
    expect(types(input)).not.toContain('ambiguous_promise');
  });
  it('flags a repeated promise that changes an already set due date as out_of_order', () => {
    const input = fixture([
      { type: 'promise', due: { date: '2026-10-09', precision: 'day' }, at: at(1) },
      { type: 'promise', due: { date: '2026-10-30', precision: 'day' }, at: at(2) },
    ], '2026-10-05T12:00:00Z');
    expect(loop(input).acts[1].flags).toEqual(['out_of_order']);
    expect(loop(input).due?.date).toBe('2026-10-09');
  });
  it('clears pendingTerms on delivery but keeps the unilateral_change fact', () => {
    const input = fixture([
      { type: 'promise', due: { date: '2026-10-20', precision: 'day' }, at: at(1) },
      { type: 'renegotiate', due: { date: '2026-10-27', precision: 'day' }, at: at(2) },
      { type: 'report_done', at: at(5) },
      { type: 'accept', at: at(6) },
    ], '2026-10-16T12:00:00Z');
    expect(loop(input).pendingTerms).toBeNull();
    expect(loop(input).state).toBe('closed');
    expect(types(input)).toContain('unilateral_change');
  });
  it('counts unanswered days from the first unanswered request, not the follow-up', () => {
    const input = fixture([
      { type: 'request', at: '2026-09-22T09:00:00Z' },
      { type: 'follow_up', at: '2026-09-25T09:00:00Z' },
    ], '2026-10-09T11:00:00Z');
    const unanswered = loop(input).breakdowns.find(item => item.type === 'unanswered_request')!;
    expect(unanswered.businessDays).toBe(13);
    expect(unanswered.sentence).toMatch(/waited 13 business days/);
  });
  it('rejects an act whose cited version has no metadata', () => {
    const input = fixture([{ type: 'request', at: at(1) }]);
    input.records = [];
    expect(() => deriveProject(input)).toThrow(EngineInputError);
  });
});
