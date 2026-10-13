import type { z } from 'zod';
import { OpenEscalationInputSchema, type ActorContext, type Escalation } from '../../../contracts';
import { actorKey, withReceipt } from '../../db/receipts';
import { escalations } from '../../db/schema';
import { lockProject, withTransaction, type Db } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { actorReference } from '../access';
import { invalid } from '../records/metadata';
import { toEscalation } from './read';

export async function openEscalation(db: Db, ctx: ActorContext, raw: z.input<typeof OpenEscalationInputSchema>): Promise<Escalation> {
  requireScope(ctx, 'escalations:write');
  const parsed = OpenEscalationInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid escalation', parsed.error);
  const input = parsed.data;
  return withTransaction(db, async tx => {
    const project = await lockProject(tx, ctx, input.projectId);
    return withReceipt(tx, { projectId: project.id, actorKey: actorKey(ctx), operation: 'open_escalation', idempotencyKey: input.idempotencyKey, input }, async () => {
      const [row] = await tx.insert(escalations).values({ workspaceId: project.workspaceId, projectId: project.id, complaint: input.complaint, author: actorReference(ctx) }).returning();
      return toEscalation(row, null);
    });
  });
}
