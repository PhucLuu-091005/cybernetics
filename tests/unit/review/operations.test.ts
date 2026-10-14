import { describe, expect, it } from 'vitest';
import type { Act, GraphSnapshot, Loop } from '../../../src/contracts';
import { GraphOperationsSchema } from '../../../src/contracts';
import {
  actToForm,
  buildActOperations,
  changeActType,
  checkCitation,
  hideAct,
  moveAct,
  partyFromValue,
  partyValue,
  setLoopMilestone,
  toAct,
  type ActForm,
} from '../../../src/components/review/operations';

const VERSION = '7c1e0000-0000-4000-8000-0000000000a2';
const TOM = 'fa2faaea-0f39-44b1-94fe-e65c0a102e7f',
  QUANG = '8a4b6eb7-d431-4929-99c8-a19a3d30ab43';
const LOOP = 'fd3d4b6e-0000-4000-8000-000000000001',
  OTHER_LOOP = 'c42b5aab-9968-43fe-904c-e896b183a2c5';
const ACT_ID = '2f318927-6220-4d3d-b7d1-92152e3a3cf1';
const citation = {
  recordVersionId: VERSION,
  start: 42,
  end: 85,
  quote: "I'll renew the secret on Monday 12 October.",
};

function form(overrides: Partial<ActForm> = {}): ActForm {
  return {
    id: ACT_ID,
    type: 'promise',
    actor: TOM,
    customer: QUANG,
    performer: TOM,
    action: 'Renew the Azure client secret for the sync app',
    dueDate: '2026-10-12',
    duePrecision: 'day',
    hedged: false,
    loopId: LOOP,
    hidden: false,
    origin: 'human',
    confidence: null,
    decision: null,
    ...overrides,
  };
}
const act = (overrides: Partial<Act> = {}): Act => ({
  id: ACT_ID,
  citation: { recordVersionId: VERSION, start: 42, end: 85 },
  type: 'promise',
  actor: { kind: 'person', personId: TOM },
  customer: { kind: 'person', personId: QUANG },
  performer: { kind: 'person', personId: TOM },
  action: 'Renew the secret',
  due: null,
  hedged: false,
  loopId: LOOP,
  hidden: false,
  origin: 'agent',
  confidence: 0.8,
  ...overrides,
});

describe('buildActOperations (proposal act editor, SRD 6.2)', () => {
  it('returns a put-act with the quote and an included decision when the cited version has no decision yet', () => {
    const operations = buildActOperations(form(), citation);
    expect(operations).toEqual([
      {
        op: 'put',
        collection: 'acts',
        quote: citation.quote,
        value: {
          id: ACT_ID,
          citation: { recordVersionId: VERSION, start: 42, end: 85 },
          type: 'promise',
          actor: { kind: 'person', personId: TOM },
          customer: { kind: 'person', personId: QUANG },
          performer: { kind: 'person', personId: TOM },
          action: 'Renew the Azure client secret for the sync app',
          due: { date: '2026-10-12', precision: 'day' },
          hedged: false,
          loopId: LOOP,
          hidden: false,
          origin: 'human',
          confidence: null,
        },
      },
      {
        op: 'put',
        collection: 'recordDecisions',
        value: { recordVersionId: VERSION, disposition: 'included', reason: '' },
      },
    ]);
    expect(GraphOperationsSchema.safeParse(operations).success).toBe(true);
  });
  it('adds no decision when the version is already included', () => {
    const operations = buildActOperations(form({ decision: 'included' }), citation);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ op: 'put', collection: 'acts', quote: citation.quote });
  });
  it('includes an ignored version, because a visible act citing an ignored record is invalid', () => {
    expect(buildActOperations(form({ decision: 'ignored' }), citation)[1]).toEqual({
      op: 'put',
      collection: 'recordDecisions',
      value: { recordVersionId: VERSION, disposition: 'included', reason: '' },
    });
  });
  it('adds no decision for a hidden act, which does not count as a visible citation', () => {
    expect(buildActOperations(form({ hidden: true }), citation)).toHaveLength(1);
  });
  it('hiding the last visible act on an included record also returns the record to pending', () => {
    const citers = [{ id: ACT_ID, hidden: false, recordVersionId: VERSION }];
    const operations = buildActOperations(
      form({ hidden: true, decision: 'included' }),
      citation,
      citers,
    );
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      op: 'put',
      collection: 'acts',
      value: { hidden: true },
      quote: citation.quote,
    });
    expect(operations[1]).toEqual({ op: 'remove', collection: 'recordDecisions', id: VERSION });
  });
  it('keeps the decision when another visible act still cites the record of a hidden act', () => {
    const citers = [
      { id: ACT_ID, hidden: false, recordVersionId: VERSION },
      { id: '11111111-1111-4111-8111-111111111111', hidden: false, recordVersionId: VERSION },
    ];
    const operations = buildActOperations(
      form({ hidden: true, decision: 'included' }),
      citation,
      citers,
    );
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ op: 'put', collection: 'acts', value: { hidden: true } });
  });
  it('maps an empty due date to null, side parties to side values and an empty loop to no loop', () => {
    const [put] = buildActOperations(
      form({ dueDate: '', customer: 'side:client', loopId: null, hedged: true }),
      citation,
    );
    expect(put).toMatchObject({
      value: { due: null, customer: { kind: 'side', side: 'client' }, loopId: null, hedged: true },
    });
  });
  it('trims the action text', () => {
    const [put] = buildActOperations(form({ action: '  Renew it  ' }), citation);
    expect(put).toMatchObject({ value: { action: 'Renew it' } });
  });
});

describe('party values', () => {
  it('round-trips people and sides', () => {
    expect(partyFromValue(TOM)).toEqual({ kind: 'person', personId: TOM });
    expect(partyFromValue('side:vendor')).toEqual({ kind: 'side', side: 'vendor' });
    expect(partyValue({ kind: 'person', personId: TOM })).toBe(TOM);
    expect(partyValue({ kind: 'side', side: 'client' })).toBe('side:client');
  });
});

describe('actToForm and toAct', () => {
  it('turns an act into an editable form that keeps its origin and confidence', () => {
    expect(actToForm(act({ due: { date: '2026-10-12', precision: 'week' } }), 'included')).toEqual({
      id: ACT_ID,
      type: 'promise',
      actor: TOM,
      customer: QUANG,
      performer: TOM,
      action: 'Renew the secret',
      dueDate: '2026-10-12',
      duePrecision: 'week',
      hedged: false,
      loopId: LOOP,
      hidden: false,
      origin: 'agent',
      confidence: 0.8,
      decision: 'included',
    });
  });
  it('strips the derived fields of an engine act', () => {
    const derived = {
      ...act(),
      occurredAt: '2026-10-09T15:10:00+07:00',
      quote: citation.quote,
      unavailable: false,
      flags: [] as 'out_of_order'[],
    };
    expect(toAct(derived)).toEqual(act());
  });
});

describe('checkCitation (exact-quote check)', () => {
  const text =
    "Hi Quang, sorry for the delay, I was out. I'll renew the secret on Monday 12 October.\n> earlier";
  it('accepts exact offsets outside quoted ranges and returns the quote', () => {
    expect(checkCitation(text, [{ start: 86, end: text.length }], 42, 85)).toEqual({
      ok: true,
      quote: "I'll renew the secret on Monday 12 October.",
    });
  });
  it('refuses offsets outside the body, inside a quoted range, longer than 400 or empty', () => {
    expect(checkCitation(text, [], 0, text.length + 1)).toEqual({
      ok: false,
      message: 'The offsets fall outside the record text.',
    });
    expect(checkCitation(text, [{ start: 80, end: text.length }], 42, 85)).toEqual({
      ok: false,
      message: 'The quote overlaps quoted text from an earlier message.',
    });
    expect(checkCitation('x'.repeat(500), [], 0, 401)).toEqual({
      ok: false,
      message: 'A quote can be at most 400 characters. This one has 401.',
    });
    expect(checkCitation(text, [], 5, 5)).toEqual({
      ok: false,
      message: 'The end offset must follow the start offset.',
    });
  });
  it('refuses an offset that splits a surrogate pair', () => {
    expect(checkCitation('🎉 party', [], 1, 4)).toEqual({
      ok: false,
      message: 'The offsets must not split a character.',
    });
  });
});

describe('loop panel edits', () => {
  const snapshot = (acts: Act[], decisions: GraphSnapshot['recordDecisions']) => ({
    acts,
    recordDecisions: decisions,
  });
  it('changes the act type and keeps every other field', () => {
    expect(changeActType(act(), citation.quote, 'report_done')).toEqual([
      { op: 'put', collection: 'acts', value: act({ type: 'report_done' }), quote: citation.quote },
    ]);
  });
  it('moves the act to another loop or to no loop', () => {
    expect(moveAct(act(), citation.quote, OTHER_LOOP)).toEqual([
      { op: 'put', collection: 'acts', value: act({ loopId: OTHER_LOOP }), quote: citation.quote },
    ]);
    expect(moveAct(act(), citation.quote, null)[0]).toMatchObject({ value: { loopId: null } });
  });
  it('hides the act and returns its record to pending when no other visible act cites it', () => {
    const operations = hideAct(
      act(),
      citation.quote,
      snapshot([act()], [{ recordVersionId: VERSION, disposition: 'included', reason: '' }]),
    );
    expect(operations).toEqual([
      { op: 'put', collection: 'acts', value: act({ hidden: true }), quote: citation.quote },
      { op: 'remove', collection: 'recordDecisions', id: VERSION },
    ]);
  });
  it('keeps the decision when another visible act still cites the record', () => {
    const sibling = act({ id: '11111111-1111-4111-8111-111111111111' });
    expect(
      hideAct(
        act(),
        citation.quote,
        snapshot(
          [act(), sibling],
          [{ recordVersionId: VERSION, disposition: 'included', reason: '' }],
        ),
      ),
    ).toHaveLength(1);
  });
  it('sets or clears the loop milestone', () => {
    const loop: Loop = {
      id: LOOP,
      title: 'Client secret renewal',
      customer: { kind: 'person', personId: QUANG },
      performer: { kind: 'person', personId: TOM },
      performerDepartmentId: '8f83b550-38ad-4276-9865-d803c8d47384',
      milestoneId: null,
    };
    const milestone = '7fd0a4a0-0d12-4bb0-b2ad-a8dab6d2f0d1';
    expect(setLoopMilestone(loop, milestone)).toEqual([
      { op: 'put', collection: 'loops', value: { ...loop, milestoneId: milestone } },
    ]);
    expect(setLoopMilestone({ ...loop, milestoneId: milestone }, null)).toEqual([
      { op: 'put', collection: 'loops', value: loop },
    ]);
  });
});
