import { desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { GetProjectInputSchema, type ActorContext, type GetProjectResult } from '../../../contracts';
import { escalationAnalyses } from '../../db/schema';
import type { Db } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { countPending } from '../inbox/list';
import { invalid } from '../records/metadata';
import { resolveView } from './hydrate';
import { READ_ONLY } from './read';

export async function getProject(db: Db, ctx: ActorContext, raw: z.input<typeof GetProjectInputSchema>): Promise<GetProjectResult> {
  requireScope(ctx, 'project:read');
  const parsed = GetProjectInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid project read', parsed.error);
  return db.transaction(async tx => {
    const { project, snapshot } = await resolveView(tx, ctx, parsed.data.projectId, { kind: 'main' });
    const [latest] = await tx.select({ graphCommitId: escalationAnalyses.graphCommitId, evidenceRevision: escalationAnalyses.evidenceRevision }).from(escalationAnalyses)
      .where(eq(escalationAnalyses.projectId, project.id)).orderBy(desc(escalationAnalyses.createdAt), desc(escalationAnalyses.id)).limit(1);
    const analysisFreshness = !latest ? 'none' : latest.graphCommitId === project.mainCommitId && latest.evidenceRevision === project.evidenceRevision ? 'current' : 'stale';
    return { project, context: snapshot.context, pendingEvidenceCount: await countPending(tx, project.id, snapshot), analysisFreshness, requestId: ctx.requestId };
  }, READ_ONLY);
}
