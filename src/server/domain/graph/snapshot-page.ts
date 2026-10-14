import type { z } from 'zod';
import {
  GetSnapshotInputSchema,
  type ActorContext,
  type GraphSnapshot,
  type SnapshotCollectionSchema,
  type SnapshotPage,
} from '../../../contracts';
import type { Db } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { invalid } from '../records/metadata';
import { resolveView } from './hydrate';
import { decodeCursor, encodeCursor, takePage } from './paging';
import { READ_ONLY, bindView, pageFields } from './read';

type Collection = z.infer<typeof SnapshotCollectionSchema>;
const byKey = <T>(items: readonly T[], key: (item: T) => string) =>
  [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

function itemsOf(snapshot: GraphSnapshot, collection: Collection): unknown[] {
  const { people, departments, milestones, ...scalars } = snapshot.context;
  switch (collection) {
    case 'context':
      return [scalars];
    case 'people':
      return byKey(people, (item) => item.id);
    case 'departments':
      return byKey(departments, (item) => item.id);
    case 'milestones':
      return byKey(milestones, (item) => item.id);
    case 'recordDecisions':
      return byKey(snapshot.recordDecisions, (item) => item.recordVersionId);
    default:
      return byKey<{ id: string }>(snapshot[collection], (item) => item.id);
  }
}

export async function getSnapshotPage(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof GetSnapshotInputSchema>,
): Promise<SnapshotPage> {
  requireScope(ctx, 'project:read');
  const parsed = GetSnapshotInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid snapshot read', parsed.error);
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const resolved = await resolveView(tx, ctx, input.projectId, input.view);
    const key = bindView('snapshot', resolved, { collection: input.collection });
    const offset = decodeCursor(input.cursor, key)?.o ?? 0;
    const items = itemsOf(resolved.snapshot, input.collection);
    const page = {
      ...pageFields(resolved, ctx),
      collection: input.collection,
      items: [] as unknown[],
    };
    const { taken, next } = takePage(items, offset, input.limit, {
      ...page,
      nextCursor: encodeCursor({ view: key, o: items.length }),
    });
    // The collection literal and its item type come from the same switch, which the union cannot express.
    return {
      ...page,
      items: taken,
      nextCursor: next === null ? null : encodeCursor({ view: key, o: next }),
    } as SnapshotPage;
  }, READ_ONLY);
}
