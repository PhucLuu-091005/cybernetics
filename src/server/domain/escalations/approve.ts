import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  ApproveAnswerInputSchema,
  type AnswerApproval,
  type ActorContext,
  type EscalationAnalysis,
} from '../../../contracts';
import { AppError } from '../../errors';
import { actorKey, withReceipt } from '../../db/receipts';
import { escalationAnalyses } from '../../db/schema';
import { isId, lockProject, withTransaction, type Db } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { actorReference } from '../access';
import { toProject } from '../projects';
import { invalid } from '../records/metadata';
import { findEscalation, isCurrent, latestAnalysis, toAnalysis } from './read';

export async function approveAnswer(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof ApproveAnswerInputSchema>,
): Promise<EscalationAnalysis> {
  if (ctx.kind !== 'user')
    throw new AppError('FORBIDDEN', 'Only browser users can approve answers');
  requireScope(ctx, 'escalations:write');
  const parsed = ApproveAnswerInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid approval', parsed.error);
  const input = parsed.data;
  return withTransaction(db, async (tx) => {
    const project = await lockProject(tx, ctx, input.projectId);
    const escalation = await findEscalation(tx, project.id, input.escalationId, true);
    return withReceipt(
      tx,
      {
        projectId: project.id,
        actorKey: actorKey(ctx),
        operation: 'approve_answer',
        idempotencyKey: input.idempotencyKey,
        input,
      },
      async () => {
        const [row] = isId(input.analysisId)
          ? await tx
              .select()
              .from(escalationAnalyses)
              .where(
                and(
                  eq(escalationAnalyses.projectId, project.id),
                  eq(escalationAnalyses.escalationId, escalation.id),
                  eq(escalationAnalyses.id, input.analysisId),
                ),
              )
              .limit(1)
          : [];
        if (!row) throw new AppError('NOT_FOUND', 'Analysis not found');
        const { mainCommitId, evidenceRevision } = toProject(project);
        const latest = await latestAnalysis(tx, project.id, escalation.id);
        const approvable =
          row.id === latest?.id &&
          row.revision === input.expectedAnalysisRevision &&
          row.contentHash === input.contentHash &&
          input.expectedMainCommitId === mainCommitId &&
          input.expectedEvidenceRevision === evidenceRevision &&
          isCurrent(row, project);
        if (!approvable)
          throw new AppError(
            'CONFLICT',
            'Approval requires the latest analysis pinned to the current main commit and evidence revision',
            {
              details: {
                latestAnalysisRevision: latest?.revision ?? null,
                mainCommitId,
                evidenceRevision,
              },
            },
          );
        if (row.approval) return toAnalysis(row);
        const approval: AnswerApproval = {
          actor: actorReference(ctx),
          approvedAt: new Date().toISOString(),
          contentHash: row.contentHash,
          mainCommitId,
          evidenceRevision,
        };
        const [updated] = await tx
          .update(escalationAnalyses)
          .set({ approval })
          .where(
            and(eq(escalationAnalyses.projectId, project.id), eq(escalationAnalyses.id, row.id)),
          )
          .returning();
        return toAnalysis(updated);
      },
    );
  });
}
