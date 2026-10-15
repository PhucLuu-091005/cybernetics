import type { ActorContext } from '../../../../../contracts';
import { RecordViewer } from '../../../../../components/inbox/RecordViewer';
import { IgnoreRecord } from '../../../../../components/review-queue/IgnoreRecord';
import { reviewHref } from '../../../../../components/review-queue/state';
import type { InboxView } from '../../../../../server/domain/inbox';
import { loadViewedRecord } from '../records/viewed-record';

type Props = {
  projectId: string;
  actor: ActorContext;
  inbox: InboxView;
  myReview: { id: string; revision: number } | null;
  timeZone: string;
};

export async function RecordDetail({ projectId, actor, inbox, myReview, timeZone }: Props) {
  const selected = inbox.selected;
  // The list already says when nothing is left, so the pane stays empty then.
  if (!selected)
    return inbox.page.items.length ? (
      <p className="faint">Select a record to read its text.</p>
    ) : null;
  const viewed = await loadViewedRecord(
    actor,
    projectId,
    selected.recordVersionId,
    timeZone,
    (versionId) => reviewHref(projectId, { tab: 'records', r: versionId }),
  );
  const basis = { mainCommitId: inbox.mainCommitId, evidenceRevision: inbox.evidenceRevision };
  const target = myReview && { id: myReview.id, revision: myReview.revision };
  return (
    <RecordViewer
      key={viewed.record.id}
      projectId={projectId}
      record={viewed.record}
      state={selected.state}
      decision={selected.decision}
      hints={viewed.hints}
      proposalId={target?.id ?? null}
      basis={basis}
    >
      <IgnoreRecord
        projectId={projectId}
        recordVersionId={viewed.record.id}
        target={target}
        basis={basis}
        citedByVisibleAct={selected.citedByVisibleAct}
      />
    </RecordViewer>
  );
}
