import type { ActorContext } from '../../../../contracts';
import type { Db } from '../../../../server/db/tx';
import { resolveView } from '../../../../server/domain/graph';
import { countPending } from '../../../../server/domain/inbox';
import { listProposals } from '../../../../server/domain/proposals';

/** Open change sets plus records nobody decided on in the approved graph. */
export async function reviewCount(db: Db, actor: ActorContext, projectId: string) {
  const [main, drafts] = await Promise.all([
    resolveView(db, actor, projectId, { kind: 'main' }),
    listProposals(db, actor, { projectId, status: 'draft', limit: 50 }),
  ]);
  return (await countPending(db, projectId, main.snapshot)) + drafts.items.length;
}
