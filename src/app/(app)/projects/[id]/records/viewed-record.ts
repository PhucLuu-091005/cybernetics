import type { ActorContext } from '../../../../../contracts';
import type { ViewedRecord } from '../../../../../components/inbox/RecordViewer';
import { shortStamp } from '../../../../../components/graph/labels';
import { getApp } from '../../../../../server/app';
import { getInboxHints } from '../../../../../server/domain/inbox';
import { readRecordText } from '../../../../../server/domain/records';
import { notFoundOn } from '../../../../../server/http/rsc';

/** Record text is read in full on the server and handed to the client as a string; it is never parsed as markup. */
export async function loadViewedRecord(actor: ActorContext, projectId: string, recordVersionId: string, timeZone: string, hintHref: (versionId: string) => string) {
  const db = getApp().db;
  const [chunk, hints] = await Promise.all([
    notFoundOn(readRecordText(db, actor, { projectId, recordVersionId })),
    notFoundOn(getInboxHints(db, actor, { projectId, recordVersionId })),
  ]);
  const meta = chunk.metadata;
  const when = meta.timePrecision === 'day' ? `${meta.occurredDate} (date only, ${meta.occurredTimeZone ?? timeZone})` : `${shortStamp(meta.occurredAt, timeZone)} ${timeZone}`;
  const record: ViewedRecord = {
    id: meta.id, title: meta.title, header: chunk.header, author: meta.author, recipients: meta.recipients, when, source: meta.source, sourceLabel: meta.sourceLabel,
    permalink: meta.permalink, attachmentNames: meta.attachmentNames, withdrawn: chunk.withdrawn, text: chunk.text, quotedRanges: meta.quotedRanges,
  };
  return { record, hints: hints.map(hint => ({ reason: hint.reason, href: hintHref(hint.recordVersionId) })) };
}
