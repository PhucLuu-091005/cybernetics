import Link from 'next/link';
import type { ActorReference } from '../../contracts';
import { reviewHref, STATE_BADGE, type ChangeSetState, type ReviewQuery } from './state';

export type SetRow = {
  id: string;
  title: string;
  author: ActorReference;
  authorName: string;
  when: string;
  state: ChangeSetState;
};

export function QueueList({
  projectId,
  query,
  sets,
  recordCount,
  records,
}: {
  projectId: string;
  query: ReviewQuery;
  sets: SetRow[];
  recordCount: number;
  records: React.ReactNode;
}) {
  return (
    <div className="queue-list">
      <nav className="tabs" role="tablist" aria-label="Review">
        <Link
          role="tab"
          aria-selected={query.tab === 'sets'}
          href={reviewHref(projectId, { tab: 'sets' })}
        >
          Change sets <span className="c">{sets.length}</span>
        </Link>
        <Link
          role="tab"
          aria-selected={query.tab === 'records'}
          href={reviewHref(projectId, { tab: 'records' })}
        >
          New records <span className="c">{recordCount}</span>
        </Link>
      </nav>
      {query.tab === 'sets' ? (
        <ul className="queue-items" aria-label="Change sets">
          {sets.map((set) => (
            <li key={set.id}>
              <Link
                href={reviewHref(projectId, { tab: 'sets', item: set.id })}
                aria-current={query.item === set.id ? 'true' : undefined}
              >
                <b>{set.title}</b>
                <small>
                  {set.author.kind === 'agent' ? (
                    <span className="badge b-agent">Agent</span>
                  ) : (
                    set.authorName
                  )}{' '}
                  · {set.when}{' '}
                  <span className={`badge q-${STATE_BADGE[set.state].tone}`}>
                    {STATE_BADGE[set.state].label}
                  </span>
                </small>
              </Link>
            </li>
          ))}
          {sets.length === 0 && <li className="faint">No open change sets.</li>}
        </ul>
      ) : (
        records
      )}
      <p className="faint queue-foot">
        Approved change sets are in{' '}
        <Link className="lnk" href={`/projects/${projectId}/history`}>
          Activity
        </Link>
        .
        {query.tab === 'records' && (
          <>
            {' '}
            <Link className="lnk" href={`/projects/${projectId}/inbox`}>
              All records
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
