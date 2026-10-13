import { describe, expect, it } from 'vitest';
import { applyOperations } from '../../../src/server/graph/apply-operations';
import { anotherAct, ids, snapshot } from '../../support/builders';

describe('applyOperations', () => {
  it('put-act adds the act and records its quote', () => {
    const { snapshot: next, quotes } = applyOperations(snapshot(), [{ op: 'put', collection: 'acts', value: anotherAct(), quote: 'Review it' }]);
    expect(next.acts.map(act => act.id)).toEqual([ids.act, ids.other]);
    expect(quotes).toEqual(new Map([[ids.other, 'Review it']]));
  });
  it('put with an existing id replaces the entity in place', () => {
    const loop = { ...snapshot().loops[0], title: 'Renamed' };
    const decision = { recordVersionId: ids.record, disposition: 'ignored' as const, reason: 'Noise' };
    const { snapshot: next } = applyOperations(snapshot(), [{ op: 'put', collection: 'loops', value: loop }, { op: 'put', collection: 'recordDecisions', value: decision }]);
    expect(next.loops).toEqual([loop]);
    expect(next.recordDecisions).toEqual([decision]);
  });
  it('remove of a missing id throws VALIDATION', () => {
    expect(() => applyOperations(snapshot(), [{ op: 'remove', collection: 'loops', id: ids.other }])).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });
  it('remove deletes an entity, keys decisions by record version and drops a quote put earlier in the batch', () => {
    const { snapshot: next, quotes } = applyOperations(snapshot(), [
      { op: 'put', collection: 'acts', value: anotherAct(), quote: 'Review it' },
      { op: 'remove', collection: 'acts', id: ids.other },
      { op: 'remove', collection: 'recordDecisions', id: ids.record },
    ]);
    expect(next.acts.map(act => act.id)).toEqual([ids.act]);
    expect(next.recordDecisions).toEqual([]);
    expect(quotes.size).toBe(0);
  });
  it('set_context with field people replaces the people array', () => {
    const people = [{ id: ids.other, name: 'Binh', side: 'client' as const, departmentId: null, role: 'PM' }];
    const { snapshot: next } = applyOperations(snapshot(), [{ op: 'set_context', field: 'people', value: people }, { op: 'set_context', field: 'replyWindowDays', value: 4 }]);
    expect(next.context.people).toEqual(people);
    expect(next.context.replyWindowDays).toBe(4);
  });
  it('does not mutate the input snapshot', () => {
    const input = snapshot(), before = structuredClone(input);
    applyOperations(input, [
      { op: 'put', collection: 'loops', value: { ...input.loops[0], title: 'Changed' } },
      { op: 'remove', collection: 'annotations', id: ids.annotation },
      { op: 'set_context', field: 'holidays', value: ['2026-10-02'] },
    ]);
    expect(input).toEqual(before);
  });
});
