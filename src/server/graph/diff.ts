import type { EntityChange, GraphSnapshot, SnapshotDiff } from '../../contracts/graph';
import { canonicalJson } from '../../lib/canonical-json';

const contextFields = [
  'timeZone',
  'windowStart',
  'windowEnd',
  'asOfOverride',
  'holidays',
  'replyWindowDays',
  'acceptWindowDays',
  'hedgeWindowDays',
  'atRiskWindowDays',
] as const;

/** Compare complete entities; array position and object property order are not identity. */
export function diffSnapshots(base: GraphSnapshot, candidate: GraphSnapshot): SnapshotDiff {
  const changes: EntityChange[] = [];
  const compare = (
    collection: EntityChange['collection'],
    id: string,
    before: EntityChange['before'],
    after: EntityChange['after'],
    existed = true,
    exists = true,
  ) => {
    if (canonicalJson(before) === canonicalJson(after)) return;
    changes.push({
      collection,
      id,
      kind: !existed ? 'added' : !exists ? 'removed' : 'changed',
      before: structuredClone(before),
      after: structuredClone(after),
    });
  };

  const arrays = [
    ['acts', base.acts, candidate.acts],
    ['loops', base.loops, candidate.loops],
    ['annotations', base.annotations, candidate.annotations],
    ['recordDecisions', base.recordDecisions, candidate.recordDecisions],
    ['people', base.context.people, candidate.context.people],
    ['departments', base.context.departments, candidate.context.departments],
    ['milestones', base.context.milestones, candidate.context.milestones],
  ] as const;
  for (const [collection, before, after] of arrays) {
    const key = (entity: (typeof before)[number]) =>
      'recordVersionId' in entity ? entity.recordVersionId : entity.id;
    const oldEntities = new Map(before.map((entity) => [key(entity), entity]));
    const newEntities = new Map(after.map((entity) => [key(entity), entity]));
    const ids = [...new Set([...oldEntities.keys(), ...newEntities.keys()])].sort();
    for (const id of ids)
      compare(
        collection,
        id,
        oldEntities.get(id) ?? null,
        newEntities.get(id) ?? null,
        oldEntities.has(id),
        newEntities.has(id),
      );
  }
  for (const field of contextFields)
    compare('context', field, base.context[field], candidate.context[field]);
  return { changes };
}
