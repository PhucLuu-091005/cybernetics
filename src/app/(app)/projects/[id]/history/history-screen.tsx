import Link from 'next/link';
import { notFound } from 'next/navigation';
import { shortStamp } from '../../../../../components/graph/labels';
import { CommitDiff } from '../../../../../components/history/CommitDiff';
import { actorName, CommitRail } from '../../../../../components/history/CommitRail';
import { RevertRestorePreview, type LaterCommit } from '../../../../../components/history/RevertRestorePreview';
import { namesFrom } from '../../../../../components/review/describe';
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

/** SRD 7.6: parent links, authors, messages and merge, revert and restore targets, newest first. */
export async function HistoryScreen({ projectId, commitId }: { projectId: string; commitId: string | null }) {
  const actor = await requireActor(`/projects/${projectId}/history`);
  const db = getApp().db;
  const [history, projects, merged, main] = await Promise.all([
    notFoundOn(listHistory(db, actor, { projectId, limit: 50 })), listProjects(db, actor),
    notFoundOn(listProposals(db, actor, { projectId, status: 'merged', limit: 50 })), notFoundOn(resolveView(db, actor, projectId, { kind: 'main' })),
  ]);
  const project = projects.find(item => item.id === projectId);
  if (!project) notFound();
  const selectedId = commitId ?? history.mainCommitId;
  const selected = await notFoundOn(getCommit(db, actor, { projectId, commitId: selectedId }));
  const { commit, diff } = selected;
  const later = history.items.filter(item => item.sequence > commit.sequence).reverse().slice(-MAX_LATER);
  const laterDiffs = await Promise.all(later.map(item => notFoundOn(getCommit(db, actor, { projectId, commitId: item.id }))));
  const laterCommits: LaterCommit[] = laterDiffs.map(read => ({ id: read.commit.id, message: read.commit.message, keys: read.diff.changes.map(keyOf) }));

  const [target, parent] = await Promise.all([
    notFoundOn(resolveView(db, actor, projectId, { kind: 'commit', commitId: commit.id })),
    commit.parentId ? notFoundOn(resolveView(db, actor, projectId, { kind: 'commit', commitId: commit.parentId })) : null,
  ]);
  const versionIds = [...diff.changes, ...laterDiffs.flatMap(read => read.diff.changes)].filter(change => change.collection === 'recordDecisions').map(change => change.id);
  const cited = await readCitedRecords(db, actor, { projectId, recordVersionIds: [...new Set(versionIds)].slice(0, 1000) });
  const names = namesFrom([main.snapshot, target.snapshot, ...(parent ? [parent.snapshot] : [])], Object.fromEntries([...cited].map(([versionId, record]) => [versionId, record.title])));
  const proposals = new Map(merged.items.map(item => [item.id, item]));
  const agentProposals = new Set(merged.items.filter(item => item.author.kind === 'agent').map(item => item.id));
  const timeZone = main.snapshot.context.timeZone;
  const proposal = commit.proposalId ? proposals.get(commit.proposalId) : undefined;
  const targetCommit = commit.targetCommitId ? history.items.find(item => item.id === commit.targetCommitId) : undefined;
  const provenance = commit.kind === 'merge'
    ? proposal ? <>proposal <Link className="lnk" href={`/projects/${projectId}/proposals/${proposal.id}`}>{proposal.title}</Link> by {proposal.author.kind === 'agent' ? <span className="badge b-agent">Agent via MCP</span> : actorName(proposal.author, actor.userId)}</> : 'a proposal'
    : commit.kind === 'initial' ? 'project creation'
    : <>{commit.kind} of <Link className="lnk" href={`/projects/${projectId}/history/${commit.targetCommitId}`}>{targetCommit ? `“${targetCommit.message}”` : commit.targetCommitId?.slice(0, 7)}</Link></>;

  return (
    <>
      <header className="topbar">
        <div className="proj"><b>{project.title}</b><small>{project.clientName} project, time zone {timeZone}</small></div>
        <span className="sp" />
        <span style={{ fontSize: 12 }}><span className="faint">Main </span><span className="id">{history.mainCommitId.slice(0, 7)}</span><span className="faint">, evidence revision </span>{history.evidenceRevision}</span>
      </header>
      <div className="screen">
        <div className="screen-head">
          <h1>History</h1>
          <p>Commits are immutable. Revert and restore create new commits on top of main, and never delete evidence or old commits.</p>
        </div>
        <div className="hist">
          <div className="card pad">
            <CommitRail projectId={projectId} commits={history.items} selectedId={commit.id} mainCommitId={history.mainCommitId} agentProposals={agentProposals} viewerUserId={actor.userId} timeZone={timeZone} />
            {history.nextCursor && <p className="faint" style={{ fontSize: 12 }}>Older commits exist; this rail shows the newest 50.</p>}
          </div>
          <div className="stack">
            <div className="card pad stack">
              <div className="row"><h2 style={{ flex: 1 }}>{commit.message}</h2><span className="id" title={commit.id}>{commit.id.slice(0, 7)}</span></div>
              <dl className="kv">
                <dt>Kind</dt><dd className={`k-${commit.kind}`} style={{ fontWeight: 700 }}>{commit.kind}</dd>
                <dt>{commit.kind === 'merge' ? 'Merged by' : 'Committed by'}</dt><dd>{commit.actor.kind === 'agent' ? <span className="badge b-agent">Agent via MCP, token {commit.actor.tokenId.slice(0, 8)}</span> : actorName(commit.actor, actor.userId)}</dd>
                <dt>Provenance</dt><dd>{provenance}</dd>
                <dt>Parent</dt><dd>{commit.parentId ? <Link className="id lnk" href={`/projects/${projectId}/history/${commit.parentId}`}>{commit.parentId.slice(0, 7)}</Link> : 'none'}</dd>
                <dt>Created</dt><dd>{shortStamp(commit.createdAt, timeZone)} {timeZone}</dd>
                <dt>Reviewed evidence</dt><dd>revision {commit.reviewedEvidenceRevision}</dd>
              </dl>
              <CommitDiff diff={diff} names={names} />
              {commit.kind === 'initial' && <p className="faint" style={{ fontSize: 12 }}>The initial commit cannot be reverted. You can restore it.</p>}
              <RevertRestorePreview key={commit.id} projectId={projectId} target={{ id: commit.id, message: commit.message, kind: commit.kind }} touched={diff.changes.map(keyOf)} later={laterCommits}
                basis={{ mainCommitId: history.mainCommitId, evidenceRevision: history.evidenceRevision }} T={evaluationTime(main.snapshot)} names={names} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
