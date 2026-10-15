import Link from 'next/link';
import { shortStamp } from '../graph/labels';
import type { InboxViewItem as Item } from '../../server/domain/inbox';
import { SOURCE_LABEL, inboxHref, type InboxQuery } from './links';

function threadHint(item: Item): string {
  if (item.parentExternalId)
    return `Reply to ${item.parentExternalId}${item.threadExternalId ? `, thread ${item.threadExternalId}` : ''}`;
  return item.threadExternalId ? `Thread ${item.threadExternalId}` : 'No thread identifier';
}

export function InboxList({
  projectId,
  items,
  query,
  selectedId,
  timeZone,
  hrefFor = (r) => inboxHref(projectId, { ...query, r }),
  emptyText = 'No records in this state for the selected graph.',
}: {
  projectId: string;
  items: Item[];
  query: InboxQuery;
  selectedId: string | null;
  timeZone: string;
  hrefFor?: (recordVersionId: string) => string;
  emptyText?: string;
}) {
  if (!items.length)
    return (
      <p className="faint card pad" style={{ fontSize: 13 }}>
        {emptyText}
      </p>
    );
  return (
    <ul className="rlist" aria-label="Records">
      {items.map((item) => (
        <li key={item.recordVersionId}>
          <Link
            className="ritem"
            href={hrefFor(item.recordVersionId)}
            aria-current={item.recordVersionId === selectedId ? 'true' : undefined}
            title={item.header}
          >
            <div className="t">{item.withdrawn ? 'Unavailable evidence' : item.title}</div>
            <div className="m">
              {item.withdrawn ? 'Withdrawn by source' : item.author.name},{' '}
              {shortStamp(item.occurredAt, timeZone)}, {item.sourceLabel} (
              {SOURCE_LABEL[item.source]})
            </div>
            <div className="x">
              {item.withdrawn ? <i>Text and link hidden after withdrawal</i> : threadHint(item)}
              {item.proposedDisposition && item.state !== item.proposedDisposition
                ? `. Decision: ${item.proposedDisposition}`
                : ''}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
