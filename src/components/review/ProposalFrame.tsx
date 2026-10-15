import Link from 'next/link';
import type { ReactNode } from 'react';
import { reviewHref } from '../review-queue/state';
import type { ActorReference, Proposal } from '../../contracts';

export type ProposalSummary = Pick<
  Proposal,
  | 'id'
  | 'title'
  | 'status'
  | 'revision'
  | 'baseCommitId'
  | 'author'
  | 'rationale'
  | 'evidenceRevision'
  | 'mergedCommitId'
>;
type Props = {
  projectId: string;
  proposal: ProposalSummary;
  mainCommitId: string;
  evidenceRevision: number;
  viewerUserId: string;
  level?: 1 | 2;
  rebaseLink?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
};

/** The author badge keys on who submitted the proposal or commit, never on act.origin. */
export function AuthorBadge({
  author,
  viewerUserId,
  prefix = 'Author',
}: {
  author: ActorReference;
  viewerUserId: string;
  prefix?: string;
}) {
  if (author.kind === 'agent')
    return (
      <span className="badge b-agent" title={`Token ${author.tokenId}`}>
        Agent via MCP, token {author.tokenId.slice(0, 8)}
      </span>
    );
  return (
    <span className="badge" style={{ color: 'var(--ink-2)' }}>
      {prefix}: {author.userId === viewerUserId ? 'you' : 'a workspace member'}
    </span>
  );
}

export function ProposalFrame({
  projectId,
  proposal,
  mainCommitId,
  evidenceRevision,
  viewerUserId,
  level = 1,
  rebaseLink = true,
  actions,
  children,
}: Props) {
  const Heading = level === 1 ? 'h1' : 'h2';
  const stale = proposal.status === 'draft' && proposal.baseCommitId !== mainCommitId;
  const unacknowledged =
    proposal.status === 'draft' && proposal.evidenceRevision !== evidenceRevision;
  const href = `/projects/${projectId}/proposals/${proposal.id}`;
  return (
    <div className="pframe">
      <div className="pband" aria-hidden="true" />
      <div className="phead">
        <span className="badge b-draft">
          Change set, {proposal.status === 'draft' ? 'open' : proposal.status}
        </span>
        <Heading style={{ fontSize: 17 }}>{proposal.title}</Heading>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12 }}>
          <span className="faint">Based on </span>
          <span className="id" title={proposal.baseCommitId}>
            {proposal.baseCommitId.slice(0, 7)}
          </span>
          {proposal.baseCommitId === mainCommitId ? (
            <span className="faint"> (current)</span>
          ) : null}
        </span>
        <span style={{ fontSize: 12 }}>
          <span className="faint">Revision </span>
          <b data-testid="proposal-revision">{proposal.revision}</b>
        </span>
        <AuthorBadge author={proposal.author} viewerUserId={viewerUserId} />
        {actions}
      </div>
      {proposal.rationale && (
        <div className="pad prationale">
          <span className="faint">
            Rationale{proposal.author.kind === 'agent' ? ' from the agent' : ''}:{' '}
          </span>
          <span style={{ whiteSpace: 'pre-wrap' }}>{proposal.rationale}</span>
        </div>
      )}
      {(stale || unacknowledged || proposal.status !== 'draft') && (
        <div className="pad pnotice">
          {proposal.status === 'merged' && (
            <span>
              This change set is approved
              {proposal.mergedCommitId ? (
                <>
                  {' '}
                  as{' '}
                  <Link
                    className="lnk"
                    href={`/projects/${projectId}/history/${proposal.mergedCommitId}`}
                  >
                    commit {proposal.mergedCommitId.slice(0, 7)}
                  </Link>
                </>
              ) : null}
              . It is read-only.
            </span>
          )}
          {proposal.status === 'closed' && (
            <span>This change set is rejected. It is read-only.</span>
          )}
          {stale && <span className="warn">Main moved since this draft was based. </span>}
          {stale && (
            <span>
              The graph changed after this change set was made.
              {rebaseLink && (
                <>
                  {' '}
                  <Link
                    className="lnk"
                    href={reviewHref(projectId, { tab: 'sets', item: proposal.id })}
                  >
                    Update to latest
                  </Link>
                </>
              )}
            </span>
          )}
          {unacknowledged && (
            <span>
              {stale ? ' ' : ''}New evidence arrived at revision {evidenceRevision}; the draft
              pinned revision {proposal.evidenceRevision}. The next save or an explicit
              acknowledgement pins it.
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
