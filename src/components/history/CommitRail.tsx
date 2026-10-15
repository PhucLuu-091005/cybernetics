import Link from 'next/link';
import type { ActorReference, ListHistoryResult } from '../../contracts';
import { shortStamp } from '../graph/labels';

type Commit = ListHistoryResult['items'][number];
const DOT = {
  merge: 'var(--route)',
  revert: 'var(--caution)',
  restore: 'var(--draft)',
  initial: 'var(--ink-2)',
} as const;
export const actorName = (actor: ActorReference, viewerUserId: string) =>
  actor.kind === 'agent'
    ? 'Agent via MCP'
    : actor.userId === viewerUserId
      ? 'you'
      : 'a workspace member';

export function CommitRail({
  projectId,
  commits,
  selectedId,
  mainCommitId,
  agentProposals,
  viewerUserId,
  timeZone,
}: {
  projectId: string;
  commits: readonly Commit[];
  selectedId: string;
  mainCommitId: string;
  agentProposals: ReadonlySet<string>;
  viewerUserId: string;
  timeZone: string;
}) {
  return (
    <ol className="commits" aria-label="Commits">
      {commits.map((commit) => {
        const agent =
          commit.actor.kind === 'agent' ||
          (commit.proposalId !== null && agentProposals.has(commit.proposalId));
        return (
          <li key={commit.id}>
            <Link
              className="commit"
              href={`/projects/${projectId}/history/${commit.id}`}
              aria-current={commit.id === selectedId ? 'page' : undefined}
            >
              <span className="rail-g" aria-hidden="true">
                <i style={{ borderColor: DOT[commit.kind] }} />
              </span>
              <span>
                <span className="row" style={{ gap: 6 }}>
                  <b>{commit.message}</b>
                </span>
                <span className="row" style={{ gap: 6, fontSize: 12 }}>
                  <span className="id">{commit.id.slice(0, 7)}</span>
                  <span className={`k-${commit.kind}`} style={{ fontWeight: 700 }}>
                    {commit.kind}
                  </span>
                  <span className="faint">
                    {actorName(commit.actor, viewerUserId)},{' '}
                    {shortStamp(commit.createdAt, timeZone)}
                  </span>
                  {agent && <span className="badge b-agent">agent</span>}
                  <span className="faint">evidence {commit.reviewedEvidenceRevision}</span>
                  {commit.id === mainCommitId && <span className="badge b-main">approved</span>}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
