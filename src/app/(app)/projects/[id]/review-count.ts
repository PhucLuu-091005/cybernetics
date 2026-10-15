import type { ActorContext } from '../../../../contracts';
import { pickMyReview } from '../../../../components/review-queue/state';
import type { Db } from '../../../../server/db/tx';
import { resolveView } from '../../../../server/domain/graph';
import { countPending } from '../../../../server/domain/inbox';
import { getProposal, listProposals } from '../../../../server/domain/proposals';

/** Records decided in "My review" leave the queue before that change set is approved, so the rail, the tabs and the notes all count against it. */
export async function reviewQueue(db: Db, actor: ActorContext, projectId: string) {
  const [main, drafts] = await Promise.all([
    resolveView(db, actor, projectId, { kind: 'main' }),
    listProposals(db, actor, { projectId, status: 'draft', limit: 50 }),
  ]);
  const myReview = pickMyReview(drafts.items, actor.userId);
  const decisions = myReview
    ? (await getProposal(db, actor, { projectId, proposalId: myReview.id })).candidate
    : main.snapshot;
  const pendingRecords = await countPending(db, projectId, decisions);
  return { main, drafts, myReview, pendingRecords };
}

export async function reviewCount(db: Db, actor: ActorContext, projectId: string) {
  const { drafts, pendingRecords } = await reviewQueue(db, actor, projectId);
  return drafts.items.length + pendingRecords;
}
