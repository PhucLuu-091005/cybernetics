import type { ActorContext, RecordDecision } from '../../../../contracts';
import { pickMyReview } from '../../../../components/review-queue/state';
import type { Db } from '../../../../server/db/tx';
import { resolveView } from '../../../../server/domain/graph';
import { countPending } from '../../../../server/domain/inbox';
import { getProposal, listProposals } from '../../../../server/domain/proposals';

/** A record is decided once the approved graph or "My review" decides it: My review can sit on an older base, so it misses decisions that later approvals added. */
export async function reviewQueue(db: Db, actor: ActorContext, projectId: string) {
  const [main, drafts] = await Promise.all([
    resolveView(db, actor, projectId, { kind: 'main' }),
    listProposals(db, actor, { projectId, status: 'draft', limit: 50 }),
  ]);
  const myReview = pickMyReview(drafts.items, actor.userId);
  const myCandidate = myReview
    ? (await getProposal(db, actor, { projectId, proposalId: myReview.id })).candidate
    : null;
  const myDecisions = new Map<string, RecordDecision>(
    (myCandidate?.recordDecisions ?? []).map((decision) => [decision.recordVersionId, decision]),
  );
  const recordDecisions = [
    ...main.snapshot.recordDecisions.filter(
      (decision) => !myDecisions.has(decision.recordVersionId),
    ),
    ...myDecisions.values(),
  ];
  const pendingRecords = await countPending(db, projectId, { ...main.snapshot, recordDecisions });
  return { main, drafts, myReview, myCandidate, myDecisions, pendingRecords };
}

export async function reviewCount(db: Db, actor: ActorContext, projectId: string) {
  const { drafts, pendingRecords } = await reviewQueue(db, actor, projectId);
  return drafts.items.length + pendingRecords;
}
