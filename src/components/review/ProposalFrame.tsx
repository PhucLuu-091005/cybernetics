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
  if (author.kind === 'agent') return <span className="badge b-agent">Agent via MCP</span>;
  return (
    <span className="badge" style={{ color: 'var(--ink-2)' }}>
      {prefix}: {author.userId === viewerUserId ? 'you' : 'a workspace member'}
    </span>
  );
}

const STATUS_LABEL = { draft: 'open', merged: 'approved', closed: 'rejected' } as const;

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
  return (
    <div className="pframe">
      <div className="pband" aria-hidden="true" />
      <div className="phead">
        <span className="badge b-draft">Change set, {STATUS_LABEL[proposal.status]}</span>
        <Heading style={{ fontSize: 17 }}>{proposal.title}</Heading>
        <span style={{ flex: 1 }} />
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
              This change set is approved. It is read-only.
              {proposal.mergedCommitId ? (
                <>
                  {' '}
                  <Link
                    className="lnk"
                    href={`/projects/${projectId}/history/${proposal.mergedCommitId}`}
                  >
                    See it in Activity
                  </Link>
                </>
              ) : null}
            </span>
          )}
          {proposal.status === 'closed' && (
            <span>This change set is rejected. It is read-only.</span>
          )}
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
              {stale ? ' ' : ''}New records arrived after this change set was made.{' '}
              <Link
                className="lnk"
                href={reviewHref(projectId, { tab: 'sets', item: proposal.id })}
              >
                Refresh it in Review
              </Link>
              .
            </span>
          )}
        </div>
      )}
      <details className="tech pad">
        <summary>Technical details</summary>
        <dl className="kv">
          <dt>Based on version</dt>
          <dd className="id">
            {proposal.baseCommitId}
            {proposal.baseCommitId === mainCommitId ? ' (current)' : ''}
          </dd>
          <dt>Change set revision</dt>
          <dd data-testid="proposal-revision">{proposal.revision}</dd>
          <dt>Evidence revision</dt>
          <dd>
            {proposal.evidenceRevision} (project: {evidenceRevision})
          </dd>
          {proposal.mergedCommitId && (
            <>
              <dt>Approved as version</dt>
              <dd className="id">{proposal.mergedCommitId}</dd>
            </>
          )}
          {proposal.author.kind === 'agent' && (
            <>
              <dt>Agent token</dt>
              <dd className="id">{proposal.author.tokenId}</dd>
            </>
          )}
        </dl>
      </details>
      {children}
    </div>
  );
}
