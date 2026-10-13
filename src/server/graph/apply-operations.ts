import type { GraphOperation, GraphSnapshot } from '../../contracts';
import { AppError } from '../errors';

type Collection = 'acts' | 'loops' | 'annotations' | 'recordDecisions';
type Entity = GraphSnapshot[Collection][number];
const keyOf = (entity: Entity) => 'recordVersionId' in entity ? entity.recordVersionId : entity.id;

function put<T extends Entity>(entities: T[], value: T): T[] {
  const index = entities.findIndex(entity => keyOf(entity) === keyOf(value));
  return index < 0 ? [...entities, value] : entities.map((entity, position) => position === index ? value : entity);
}

/** Pure; the caller validates the final snapshot, so dependent operations in one batch are checked together. */
export function applyOperations(snapshot: GraphSnapshot, ops: GraphOperation[]): { snapshot: GraphSnapshot; quotes: Map<string, string> } {
  const next = structuredClone(snapshot), quotes = new Map<string, string>();
  for (const [index, op] of ops.entries()) {
    if (op.op === 'set_context') { Object.assign(next.context, { [op.field]: structuredClone(op.value) }); continue; }
    const entities: Entity[] = next[op.collection];
    if (op.op === 'remove') {
      if (!entities.some(entity => keyOf(entity) === op.id)) throw new AppError('VALIDATION', 'Operation removes a missing entity', { errors: [{ path: `operations.${index}.id`, message: `No ${op.collection} entity has id ${op.id}` }] });
      Object.assign(next, { [op.collection]: entities.filter(entity => keyOf(entity) !== op.id) });
      if (op.collection === 'acts') quotes.delete(op.id);
      continue;
    }
    Object.assign(next, { [op.collection]: put(entities, structuredClone(op.value)) });
    if (op.collection === 'acts') quotes.set(op.value.id, op.quote);
  }
  return { snapshot: next, quotes };
}
