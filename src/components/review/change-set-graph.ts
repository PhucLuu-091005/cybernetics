import type { EntityChange, Proposal } from '../../contracts';
import { parseFilters } from '../graph/filters';
import type { GraphScreenProps } from '../graph/GraphScreen';
import { proposalHighlights } from './describe';

/** The GraphScreen props that every change set graph shares, plus the acts and loops the change set touches. */
export function changeSetGraph(
  proposal: Pick<Proposal, 'id' | 'revision' | 'status' | 'author'>,
  basis: { mainCommitId: string; evidenceRevision: number },
  changes: readonly EntityChange[],
) {
  const { loopIds, actIds } = proposalHighlights(changes);
  const props = {
    initialFilters: parseFilters(new URLSearchParams()),
    view: { kind: 'proposal', proposalId: proposal.id, proposalRevision: proposal.revision },
    edit: {
      kind: 'proposal',
      basis,
      proposalId: proposal.id,
      revision: proposal.revision,
      status: proposal.status,
    },
    changedLoopIds: loopIds,
    agentActIds: proposal.author.kind === 'agent' ? actIds : [],
  } satisfies Partial<GraphScreenProps>;
  return { props, focus: { actIds, loopIds } };
}
