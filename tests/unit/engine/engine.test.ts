import { describe, expect, it } from 'vitest';
import { deriveProject, EngineInputError } from '../../../src/server/loops/engine';
import { EngineOutputSchema } from '../../../src/contracts/engine';
import { customer, due, fixture, laterDue, loop, performer, types, uuid, type Step } from '../../support/engine-builders';

const request: Step = { type: 'request' };
const promise: Step = { type: 'promise', due };
const counter: Step = { type: 'counter', due };
const change: Step = { type: 'renegotiate', due: laterDue };
const delivered: Step[] = [promise, { type: 'report_done' }];
const closed: Step[] = [promise, { type: 'accept' }];

const transitions: [string, Step[], string][] = [
  ['new request', [request], 'requested'], ['new promise', [promise], 'promised'],
  ['requested promise', [request, promise], 'promised'], ['requested counter', [request, counter], 'negotiating'],
  ['requested decline', [request, { type: 'decline' }], 'declined'], ['requested cancel', [request, { type: 'cancel' }], 'cancelled'],
  ['requested follow up', [request, { type: 'follow_up' }], 'requested'],
  ['negotiating counter', [request, counter, { ...counter, actor: customer }], 'negotiating'],
  ['negotiating agree', [request, counter, { type: 'agree_change' }], 'promised'],
  ['negotiating promise', [request, counter, promise], 'promised'],
  ['negotiating decline', [request, counter, { type: 'decline', actor: customer }], 'declined'],
  ['negotiating cancel', [request, counter, { type: 'cancel' }], 'cancelled'],
  ['promised renegotiate', [promise, change], 'change_pending'], ['promised delivery', delivered, 'delivered'],
  ['promised implicit acceptance', closed, 'closed'], ['promised follow up', [promise, { type: 'follow_up' }], 'promised'],
  ['promised clarification', [promise, { type: 'promise' }], 'promised'], ['promised cancel', [promise, { type: 'cancel' }], 'cancelled'],
  ['pending agree', [promise, change, { type: 'agree_change' }], 'promised'],
  ['pending decline', [promise, change, { type: 'decline', actor: customer }], 'promised'],
  ['pending delivery', [promise, change, { type: 'report_done' }], 'delivered'],
  ['delivered acceptance', [...delivered, { type: 'accept' }], 'closed'],
  ['delivered rejection', [...delivered, { type: 'reject' }], 'promised'],
  ['closed rejection', [...closed, { type: 'reject' }], 'promised'],
];
describe('transition table', () => {
  it.each(transitions)('%s', (_name, steps, want) => {
    const result = loop(fixture(steps));
    expect(result?.state).toBe(want);
    expect(result.acts.at(-1)?.flags).toEqual([]);
  });
  it('records timestamps, original terms, nudges and implicit delivery', () => {
    const result = loop(fixture([request, { type: 'follow_up' }, promise, { type: 'accept' }]));
    expect(result).toMatchObject({ requestedAt: '2026-10-05T12:00:00Z', promisedAt: '2026-10-07T12:00:00Z', deliveredAt: '2026-10-08T12:00:00Z', closedAt: '2026-10-08T12:00:00Z', originalDue: due, due, dueAt: '2026-10-09T23:59:59.999Z', nudges: 1 });
  });
  it.each(['declined', 'cancelled'] as const)('sets termination on %s', state => {
    expect(loop(fixture([request, { type: state === 'declined' ? 'decline' : 'cancel' }])).terminatedAt).toBe('2026-10-06T12:00:00Z');
  });
  it('ignores wrong roles, invalid state pairs and conflicting repeated terms', () => {
    const result = loop(fixture([promise, { type: 'promise', due: laterDue }, { type: 'accept', actor: performer }, request]));
    expect(result.state).toBe('promised');
    expect(result.due).toEqual(due);
    expect(result.acts.slice(1).map(act => act.flags)).toEqual(Array(3).fill(['out_of_order']));
  });
  it('clarifies missing due and hedging without overwriting original due', () => {
    expect(loop(fixture([{ type: 'promise', hedged: true }, promise]))).toMatchObject({ due, originalDue: null, hedged: false });
  });
  it('requires the other party to agree or decline pending terms', () => {
    const result = loop(fixture([promise, change, { type: 'agree_change', actor: performer }, { type: 'decline' }]));
    expect(result.state).toBe('change_pending');
    expect(result.acts.slice(2).map(act => act.flags)).toEqual([['out_of_order'], ['out_of_order']]);
  });
  it('accepts opposite-side colleagues and side actors', () => {
    expect(loop(fixture([promise, { type: 'accept', actor: { kind: 'person', personId: uuid('colleague') } }])).state).toBe('closed');
    expect(loop(fixture([{ ...promise, actor: { kind: 'side', side: 'vendor' } }])).state).toBe('promised');
  });
  it('resolves same-side roles by department', () => {
    const input = fixture([promise, change, { type: 'agree_change' }]);
    input.snapshot.context.people[1].side = 'client';
    expect(loop(input).state).toBe('promised');
    input.snapshot.context.people[1].departmentId = uuid('implementation');
    expect(loop(input).acts[2].flags).toEqual(['out_of_order']);
  });
});
describe('breakdowns and cycle history', () => {
  it('unanswered request counts from the first unanswered customer act and excludes timely or performer replies', () => {
    const input = fixture([request, { type: 'follow_up', at: '2026-10-08T12:00:00Z' }]);
    expect(loop(input).breakdowns[0]).toMatchObject({ type: 'unanswered_request', proofActIds: [uuid('act-00'), uuid('act-01')], businessDays: 9 });
    expect(types({ ...input, T: '2026-10-12T12:00:00Z' })).not.toContain('unanswered_request');
    expect(types(fixture([request, counter]))).not.toContain('unanswered_request');
    expect(types(fixture([request, counter, { ...counter, actor: customer }]))).toContain('unanswered_request');
  });
  it('silent overdue excludes delivery and timely notice but retains late notice', () => {
    expect(types(fixture([promise]))).toContain('silent_overdue');
    expect(types(fixture(delivered))).not.toContain('silent_overdue');
    expect(types(fixture([promise, change]))).not.toContain('silent_overdue');
    expect(types(fixture([promise, { ...change, at: '2026-10-12T12:00:00Z' }]))).toContain('silent_overdue');
    expect(types(fixture([promise], '2026-10-09T23:59:59.999Z'))).not.toContain('silent_overdue');
  });
  it('checks each delivery against its historical effective deadline', () => {
    const result = loop(fixture([promise, { type: 'report_done', at: '2026-10-12T12:00:00Z' }, { type: 'reject', at: '2026-10-13T12:00:00Z' }, { ...change, at: '2026-10-14T12:00:00Z' }, { type: 'agree_change', at: '2026-10-15T12:00:00Z' }]));
    expect(result.due).toEqual(laterDue);
    expect(result.breakdowns.find(item => item.type === 'late_delivery')).toMatchObject({ proofActIds: [uuid('act-00'), uuid('act-01')], businessDays: 1, endAt: '2026-10-12T12:00:00Z' });
    expect(types(fixture([promise, change, { type: 'agree_change' }, { type: 'accept', at: '2026-10-12T12:00:00Z' }]))).not.toContain('late_delivery');
    expect(types(fixture([promise, { type: 'accept', at: '2026-10-12T12:00:00Z' }]))).toContain('late_delivery');
  });
  it('rejection clears active delivery, closed time and pending terms while retaining deadline and proof', () => {
    const result = loop(fixture([promise, change, { type: 'report_done' }, { type: 'accept' }, { type: 'reject' }]));
    expect(result).toMatchObject({ state: 'promised', due, deliveredAt: null, closedAt: null, pendingTerms: null, cycleStartedAt: '2026-10-09T12:00:00Z', rejections: 1, rejectionActIds: [uuid('act-04')] });
    expect(result.breakdowns.find(item => item.type === 'silent_overdue')?.proofActIds).toEqual([uuid('act-00'), uuid('act-04')]);
    expect(result.breakdowns.find(item => item.type === 'rejected_delivery')?.proofActIds).toEqual([uuid('act-02'), uuid('act-04')]);
    expect(types(fixture([...delivered, { type: 'reject' }, { type: 'report_done' }, { type: 'accept' }]))).toContain('rejected_delivery');
  });
  it('unilateral change clears on resolution but preserves delivery under unagreed terms', () => {
    expect(types(fixture([promise, change]))).toContain('unilateral_change');
    expect(types(fixture([promise, change], '2026-10-08T12:00:00Z'))).not.toContain('unilateral_change');
    expect(types(fixture([promise, change, { type: 'agree_change' }]))).not.toContain('unilateral_change');
    expect(types(fixture([promise, change, { type: 'decline', actor: customer }]))).not.toContain('unilateral_change');
    expect(types(fixture([promise, change, { type: 'report_done' }, { type: 'accept' }]))).toContain('unilateral_change');
  });
  it('ambiguous promise clears on firm clarification, delivery or termination', () => {
    const hedge: Step = { type: 'promise', hedged: true };
    expect(types(fixture([hedge]))).toContain('ambiguous_promise');
    expect(types(fixture([hedge], '2026-10-12T12:00:00Z'))).not.toContain('ambiguous_promise');
    for (const resolution of [{ type: 'promise' }, { type: 'report_done' }, { type: 'cancel' }] as Step[]) expect(types(fixture([hedge, resolution]))).not.toContain('ambiguous_promise');
  });
  it('ambiguous promise sentence keeps one final punctuation mark after the quote', () => {
    const sentence = (body: string) => {
      const input = fixture([{ type: 'promise', hedged: true, citation: { recordVersionId: uuid('record-0'), start: 0, end: body.length } }]);
      input.records[0].bodyText = body;
      return loop(input).breakdowns.find(item => item.type === 'ambiguous_promise')!.sentence;
    };
    expect(sentence("We'll look into it.")).toBe('Ben said "We\'ll look into it." The client may read this as a commitment.');
    expect(sentence('Maybe next week?')).toBe('Ben said "Maybe next week?" The client may read this as a commitment.');
    expect(sentence('Sure thing!')).toBe('Ben said "Sure thing!" The client may read this as a commitment.');
    expect(sentence("We'll look into it")).toBe('Ben said "We\'ll look into it". The client may read this as a commitment.');
  });
  it('unconfirmed delivery clears on acceptance or rejection and uses business day threshold', () => {
    expect(types(fixture(delivered))).toContain('unconfirmed_delivery');
    expect(types(fixture(delivered, '2026-10-13T12:00:00Z'))).not.toContain('unconfirmed_delivery');
    expect(types(fixture([...delivered, { type: 'accept' }]))).not.toContain('unconfirmed_delivery');
    expect(types(fixture([...delivered, { type: 'reject' }]))).not.toContain('unconfirmed_delivery');
  });
  it('excludes holidays and weekends and marks future open promises due soon', () => {
    const input = fixture([promise], '2026-10-07T12:00:00Z');
    expect(loop(input).dueSoon).toBe(true);
    expect(loop(fixture(delivered, '2026-10-07T12:00:00Z')).dueSoon).toBe(false);
    input.snapshot.context.holidays = ['2026-10-08'];
    expect(loop({ ...input, T: '2026-10-06T12:00:00Z' }).dueSoon).toBe(true);
  });
});
describe('deterministic evidence and milestones', () => {
  it('excludes hidden and future acts with numeric timestamp ordering and stable ID ties', () => {
    const input = fixture([{ type: 'accept', id: uuid('z'), at: '2026-10-05T12:00:00Z' }, { ...promise, id: uuid('a'), at: '2026-10-05T14:00:00+02:00' }, { type: 'accept', at: '2026-10-17T12:00:00Z' }, { type: 'cancel', hidden: true }]);
    const before = JSON.stringify(input.snapshot);
    expect(loop(input).acts.map(act => act.id)).toEqual([uuid('a'), uuid('z')]);
    expect(loop(input).state).toBe('closed');
    const reordered = structuredClone(input); reordered.snapshot.acts.reverse(); reordered.records.reverse();
    expect(JSON.stringify(deriveProject(reordered))).toBe(JSON.stringify(deriveProject(input)));
    expect(JSON.stringify(input.snapshot)).toBe(before);
    expect(EngineOutputSchema.safeParse(deriveProject(input)).success).toBe(true);
  });
  it('future acceptance does not suppress current warnings and changing T leaves snapshot unchanged', () => {
    const input = fixture([...delivered, { type: 'accept', at: '2026-10-20T12:00:00Z' }]);
    expect(loop(input).state).toBe('delivered');
    expect(types(input)).toContain('unconfirmed_delivery');
    expect(types({ ...input, T: '2026-10-21T12:00:00Z' })).not.toContain('unconfirmed_delivery');
    expect(input.snapshot.acts).toHaveLength(3);
  });
  it('keeps withdrawn interpretations while masking unavailable quote and quoted ranges', () => {
    const input = fixture([promise]); input.records[0].withdrawn = true; input.records[0].bodyText = null;
    expect(loop(input)).toMatchObject({ state: 'promised', acts: [{ quote: null, unavailable: true }] });
    expect(deriveProject(input).unavailableEvidenceCount).toBe(1);
    const masked = fixture([promise]); masked.records[0].quotedRanges = [{ start: 0, end: 4 }];
    expect(loop(masked).acts[0].quote).toBeNull();
    expect(loop(fixture([promise])).acts[0].quote).toBe('Mapping done');
  });
  it('does not assign unlinked acts or invent time for missing records', () => {
    const input = fixture([{ ...promise, loopId: null }, request]); input.records.pop();
    expect(() => deriveProject(input)).toThrow(EngineInputError);
    const unlinked = fixture([{ ...promise, loopId: null }, request]);
    expect(deriveProject(unlinked).unassignedActIds).toEqual([uuid('act-00')]);
    expect(loop(unlinked).state).toBe('requested');
  });
  it('derives reached, blocked, at risk and on track without mutating milestone dates', () => {
    expect(deriveProject(fixture(closed)).milestones[0].status).toBe('reached');
    expect(deriveProject(fixture([request], '2026-10-20T00:00:00Z')).milestones[0].status).toBe('blocked');
    expect(deriveProject(fixture([promise], '2026-10-14T12:00:00Z')).milestones[0].status).toBe('at_risk');
    expect(deriveProject(fixture([promise], '2026-10-05T12:00:00Z')).milestones[0].status).toBe('on_track');
    const input = fixture([promise, change, { type: 'agree_change' }]); input.snapshot.context.milestones[0].currentDate = '2026-10-09';
    expect(deriveProject(input).milestones[0].currentDate).toBe('2026-10-20');
    expect(input.snapshot.context.milestones[0].currentDate).toBe('2026-10-09');
    const explicit = fixture([promise]); explicit.snapshot.context.milestones[0].reachedAt = '2026-10-05T12:00:00Z';
    expect(deriveProject(explicit).milestones[0].status).toBe('reached');
  });
  it('counts state, historical broken loops, warning loops and open loops separately', () => {
    const output = deriveProject(fixture([promise, { type: 'accept', at: '2026-10-12T12:00:00Z' }]));
    expect(output.counts).toMatchObject({ states: { closed: 1 }, breakdowns: { late_delivery: 1 }, brokenLoops: 1, warningLoops: 0, openLoops: 0, closedLoops: 1 });
  });
});
