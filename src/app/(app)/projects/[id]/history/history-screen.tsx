import Link from 'next/link';
import { notFound } from 'next/navigation';
import { shortStamp } from '../../../../../components/graph/labels';
import { CommitDiff } from '../../../../../components/history/CommitDiff';
import { actorName, CommitRail, KIND_LABEL } from '../../../../../components/history/CommitRail';
import {
  RevertRestorePreview,
  type LaterCommit,
} from '../../../../../components/history/RevertRestorePreview';
import { capRecordIds, namesFrom } from '../../../../../components/review/describe';
import { OmittedRecordsNote } from '../../../../../components/review/fields';
import { getApp } from '../../../../../server/app';
import { getCommit, listHistory } from '../../../../../server/domain/commits';
import { evaluationTime, resolveView } from '../../../../../server/domain/graph';
import { listProjects } from '../../../../../server/domain/projects';
import { listProposals } from '../../../../../server/domain/proposals';
import { readCitedRecords } from '../../../../../server/domain/records';
import { notFoundOn, requireActor } from '../../../../../server/http/rsc';

// Later commits name the change a revert keeps or a restore replaces; the cap bounds the reads for a long history.
const MAX_LATER = 20;
const keyOf = (change: { collection: string; id: string }) => `${change.collection}/${change.id}`;

export async function HistoryScreen({
  projectId,
  commitId,
}: {
  projectId: string;
  commitId: string | null;
}) {
  const actor = await requireActor(`/projects/${projectId}/history`);
  const db = getApp().db;
  const [history, projects, merged, main] = await Promise.all([
    notFoundOn(listHistory(db, actor, { projectId, limit: 50 })),
    listProjects(db, actor),
    notFoundOn(listProposals(db, actor, { projectId, status: 'merged', limit: 50 })),
    notFoundOn(resolveView(db, actor, projectId, { kind: 'main' })),
  ]);
  const project = projects.find((item) => item.id === projectId);
  if (!project) notFound();
  const selectedId = commitId ?? history.mainCommitId;
  const selected = await notFoundOn(getCommit(db, actor, { projectId, commitId: selectedId }));
  const { commit, diff } = selected;
  const later = history.items
    .filter((item) => item.sequence > commit.sequence)
    .reverse()
    .slice(-MAX_LATER);
  const laterDiffs = await Promise.all(
    later.map((item) => notFoundOn(getCommit(db, actor, { projectId, commitId: item.id }))),
  );
  const laterCommits: LaterCommit[] = laterDiffs.map((read) => ({
    id: read.commit.id,
    message: read.commit.message,
    keys: read.diff.changes.map(keyOf),
  }));

  const [target, parent] = await Promise.all([
    notFoundOn(resolveView(db, actor, projectId, { kind: 'commit', commitId: commit.id })),
    commit.parentId
      ? notFoundOn(resolveView(db, actor, projectId, { kind: 'commit', commitId: commit.parentId }))
      : null,
  ]);
  const versionIds = [...diff.changes, ...laterDiffs.flatMap((read) => read.diff.changes)]
    .filter((change) => change.collection === 'recordDecisions')
    .map((change) => change.id);
  const wanted = capRecordIds(versionIds);
  const cited = await readCitedRecords(db, actor, { projectId, recordVersionIds: wanted.ids });
  const names = namesFrom(
    [main.snapshot, target.snapshot, ...(parent ? [parent.snapshot] : [])],
    Object.fromEntries([...cited].map(([versionId, record]) => [versionId, record.title])),
  );
  const proposals = new Map(merged.items.map((item) => [item.id, item]));
  const agentProposals = new Set(
    merged.items.filter((item) => item.author.kind === 'agent').map((item) => item.id),
  );
  const timeZone = main.snapshot.context.timeZone;
  const proposal = commit.proposalId ? proposals.get(commit.proposalId) : undefined;
  const targetCommit = commit.targetCommitId
    ? history.items.find((item) => item.id === commit.targetCommitId)
    : undefined;
  const parentCommit = commit.parentId
    ? history.items.find((item) => item.id === commit.parentId)
    : undefined;
  const provenance =
    commit.kind === 'merge' ? (
      proposal ? (
        <>
          change set{' '}
          <Link className="lnk" href={`/projects/${projectId}/proposals/${proposal.id}`}>
            {proposal.title}
          </Link>{' '}
          by{' '}
          {proposal.author.kind === 'agent' ? (
            <span className="badge b-agent">Agent via MCP</span>
          ) : (
            actorName(proposal.author, actor.userId)
          )}
        </>
      ) : (
        'a change set'
      )
    ) : commit.kind === 'initial' ? (
      'project creation'
    ) : (
      <>
        {commit.kind === 'revert' ? 'Undo of' : 'Go back to'}{' '}
        <Link className="lnk" href={`/projects/${projectId}/history/${commit.targetCommitId}`}>
          {targetCommit ? `“${targetCommit.message}”` : 'an older version'}
        </Link>
      </>
    );

  return (
    <>
      <header className="topbar">
        <div className="proj">
          <b>{project.title}</b>
          <small>
            {project.clientName} project, time zone {timeZone}
          </small>
        </div>
      </header>
      <div className="screen">
        <div className="screen-head">
          <h1>Activity</h1>
          <p>
            Each version stays. &quot;Undo this change&quot; and &quot;Go back to this version&quot;
            add a new version on top of the approved graph and never delete records or old versions.
          </p>
        </div>
        <div className="hist">
          <div className="card pad">
            <CommitRail
              projectId={projectId}
              commits={history.items}
              selectedId={commit.id}
              mainCommitId={history.mainCommitId}
              agentProposals={agentProposals}
              viewerUserId={actor.userId}
              timeZone={timeZone}
            />
            {history.nextCursor && (
              <p className="faint" style={{ fontSize: 12 }}>
                Older versions exist. This list shows the newest 50.
              </p>
            )}
          </div>
          <div className="stack">
            <div className="card pad stack">
              <h2>{commit.message}</h2>
              <dl className="kv">
                <dt>Type</dt>
                <dd className={`k-${commit.kind}`} style={{ fontWeight: 700 }}>
                  {KIND_LABEL[commit.kind]}
                </dd>
                <dt>{commit.kind === 'merge' ? 'Approved by' : 'Changed by'}</dt>
                <dd>
                  {commit.actor.kind === 'agent' ? (
                    <span className="badge b-agent">Agent via MCP</span>
                  ) : (
                    actorName(commit.actor, actor.userId)
                  )}
                </dd>
                <dt>From</dt>
                <dd>{provenance}</dd>
                <dt>Previous version</dt>
                <dd>
                  {commit.parentId ? (
                    <Link
                      className="lnk"
                      href={`/projects/${projectId}/history/${commit.parentId}`}
                    >
                      {parentCommit ? `“${parentCommit.message}”` : 'An older version'}
                    </Link>
                  ) : (
                    'none'
                  )}
                </dd>
                <dt>Created</dt>
                <dd>
                  {shortStamp(commit.createdAt, timeZone)} {timeZone}
                </dd>
              </dl>
              <details key={`tech-${commit.id}`} className="tech">
                <summary>Technical details</summary>
                <dl className="kv">
                  <dt>Version id</dt>
                  <dd className="id" data-testid="commit-id">
                    {commit.id}
                  </dd>
                  <dt>Previous version id</dt>
                  <dd className="id">{commit.parentId ?? 'none'}</dd>
                  <dt>Approved graph now</dt>
                  <dd className="id">{history.mainCommitId}</dd>
                  <dt>Reviewed evidence revision</dt>
                  <dd>{commit.reviewedEvidenceRevision}</dd>
                  {commit.actor.kind === 'agent' && (
                    <>
                      <dt>Agent token</dt>
                      <dd className="id">{commit.actor.tokenId}</dd>
                    </>
                  )}
                </dl>
              </details>
              <CommitDiff diff={diff} names={names} />
              <OmittedRecordsNote omitted={wanted.omitted} />
              {commit.kind === 'initial' && (
                <p className="faint" style={{ fontSize: 12 }}>
                  The first version cannot be undone. You can go back to it.
                </p>
              )}
              <RevertRestorePreview
                key={commit.id}
                projectId={projectId}
                target={{ id: commit.id, message: commit.message, kind: commit.kind }}
                touched={diff.changes.map(keyOf)}
                later={laterCommits}
                basis={{
                  mainCommitId: history.mainCommitId,
                  evidenceRevision: history.evidenceRevision,
                }}
                T={evaluationTime(main.snapshot)}
                names={names}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
