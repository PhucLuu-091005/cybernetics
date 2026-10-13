import { GraphSnapshotSchema, type Conflict, type EntityChange, type GraphContext,
  type GraphSnapshot, type RebaseResult } from '../../contracts/graph';
import { canonicalJson } from '../../lib/canonical-json';
import { diffSnapshots } from './diff';
import { referenceErrors } from './references';

type Collection = EntityChange['collection'];
type ContextField = Exclude<keyof GraphContext, 'people' | 'departments' | 'milestones'>;

function replace<T extends { id: string }>(entities: T[], change: EntityChange): T[] {
  const index = entities.findIndex(entity => entity.id === change.id);
  if (change.kind === 'removed') return entities.filter(entity => entity.id !== change.id);
  // applyChange dispatches a diff image to the same collection it originated in.
  const value = structuredClone(change.after) as unknown as T;
  if (index < 0) return [...entities, value];
  return entities.map((entity, position) => position === index ? value : entity);
}

export function applyChange(snapshot: GraphSnapshot, change: EntityChange): void {
  switch (change.collection) {
    case 'acts': snapshot.acts = replace(snapshot.acts, change); break;
    case 'loops': snapshot.loops = replace(snapshot.loops, change); break;
    case 'annotations': snapshot.annotations = replace(snapshot.annotations, change); break;
    case 'people': snapshot.context.people = replace(snapshot.context.people, change); break;
    case 'departments': snapshot.context.departments = replace(snapshot.context.departments, change); break;
    case 'milestones': snapshot.context.milestones = replace(snapshot.context.milestones, change); break;
    case 'recordDecisions': {
      const values = snapshot.recordDecisions.filter(entity => entity.recordVersionId !== change.id);
      if (change.kind !== 'removed') values.push(structuredClone(change.after) as GraphSnapshot['recordDecisions'][number]);
      snapshot.recordDecisions = values;
      break;
    }
    case 'context': Object.assign(snapshot.context, { [change.id]: structuredClone(change.after) }); break;
  }
}

export function entityAt(snapshot: GraphSnapshot, collection: Collection, id: string): EntityChange['before'] {
  if (collection === 'context') return snapshot.context[id as ContextField];
  if (collection === 'recordDecisions') return snapshot.recordDecisions.find(entity => entity.recordVersionId === id) ?? null;
  const values = collection === 'people' || collection === 'departments' || collection === 'milestones'
    ? snapshot.context[collection] : snapshot[collection];
  return values.find(entity => entity.id === id) ?? null;
}

/** Composition checks only snapshot-local references. Citation/evidence checks remain in the domain validator. */
export function compositionConflicts(snapshot: GraphSnapshot, base: GraphSnapshot,
  candidate: GraphSnapshot, main: GraphSnapshot, changes: EntityChange[]): Conflict[] {
  const conflicts = new Map<string, Conflict>();
  const add = (collection: Collection, id: string, reason: string) => {
    const key = `${collection}/${id}`;
    const previous = conflicts.get(key);
    if (previous) { previous.reason += ` ${reason}`; return; }
    conflicts.set(key, { collection, id, base: structuredClone(entityAt(base, collection, id)),
      main: structuredClone(entityAt(main, collection, id)),
      proposed: structuredClone(entityAt(candidate, collection, id)), reason });
  };
  for (const error of referenceErrors(snapshot)) add(error.collection, error.id, error.message);

  const parsed = GraphSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [root, field] = issue.path;
      // Bind cross-entity/cap errors to an actual changed entity for explicit resolution.
      const contextCollection = root === 'context' && (field === 'people' || field === 'departments' || field === 'milestones') ? field : null;
      const collection = contextCollection ?? (root === 'context' ? 'context' : root);
      const change = changes.find(value => value.collection === collection && (collection !== 'context' || !field || value.id === field))
        ?? changes[0];
      const id = root === 'context' && typeof field === 'string' && !contextCollection
        ? field : change?.id ?? 'windowStart';
      add(change?.collection ?? 'context', id, `Composed snapshot is invalid: ${issue.message}. Resolve the participating entities and validate again.`);
    }
  }
  return [...conflicts.values()];
}

/** Keep one-sided/identical changes; a whole entity is the unit of conflict. */
export function threeWayRebase(base: GraphSnapshot, candidate: GraphSnapshot, main: GraphSnapshot): RebaseResult {
  const proposedChanges = diffSnapshots(base, candidate).changes;
  const mainChanges = diffSnapshots(base, main).changes;
  const currentChanges = new Map(mainChanges.map(change => [`${change.collection}/${change.id}`, change]));
  const snapshot = structuredClone(main);
  const conflicts: Conflict[] = [];
  for (const change of proposedChanges) {
    const current = currentChanges.get(`${change.collection}/${change.id}`);
    if (!current) { applyChange(snapshot, change); continue; }
    if (canonicalJson(change.after) === canonicalJson(current.after)) continue;
    const reason = change.kind === 'removed' || current.kind === 'removed'
      ? 'An entity was deleted on one side and edited on the other.'
      : change.kind === 'added' ? 'Both sides added incompatible entities with the same ID.'
        : 'Both sides made different edits to the same complete entity.';
    conflicts.push({ collection: change.collection, id: change.id, base: change.before,
      main: current.after, proposed: change.after, reason });
  }
  if (conflicts.length) {
    // Divergent entities default to main's image so reference conflicts on other entities stay resolvable.
    const divergent = new Set(conflicts.map(conflict => `${conflict.collection}/${conflict.id}`));
    const defaults = structuredClone(main);
    for (const change of proposedChanges) {
      if (!currentChanges.has(`${change.collection}/${change.id}`)) applyChange(defaults, change);
    }
    const composed = compositionConflicts(defaults, base, candidate, main, [...proposedChanges, ...mainChanges])
      .filter(conflict => !divergent.has(`${conflict.collection}/${conflict.id}`));
    return { snapshot: null, conflicts: [...conflicts, ...composed] };
  }
  const invalid = compositionConflicts(snapshot, base, candidate, main, [...proposedChanges, ...mainChanges]);
  return invalid.length ? { snapshot: null, conflicts: invalid } : { snapshot, conflicts: [] };
}
