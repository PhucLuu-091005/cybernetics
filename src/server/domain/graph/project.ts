import type { z } from 'zod';
import {
  GetProjectInputSchema,
  type ActorContext,
  type GetProjectResult,
} from '../../../contracts';
import type { Db } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { countPending } from '../inbox/list';
import { invalid } from '../records/metadata';
import { resolveView } from './hydrate';
import { READ_ONLY } from './read';

export async function getProject(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof GetProjectInputSchema>,
): Promise<GetProjectResult> {
  requireScope(ctx, 'project:read');
  const parsed = GetProjectInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid project read', parsed.error);
  return db.transaction(async (tx) => {
    const { project, snapshot } = await resolveView(tx, ctx, parsed.data.projectId, {
      kind: 'main',
    });
    return {
      project,
      context: snapshot.context,
      pendingEvidenceCount: await countPending(tx, project.id, snapshot),
      requestId: ctx.requestId,
    };
  }, READ_ONLY);
}
