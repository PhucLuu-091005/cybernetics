'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { zonedInstant } from '../../lib/calendar';
import { createTimeScale } from '../../lib/graph-layout';

export type HeadCommit = { id: string; verb: string; at: string; by: string | null };
type Props = {
  projectId: string;
  title: string;
  clientName: string;
  timeZone: string;
  windowStart: string;
  T: string;
  explicitT: boolean;
  head: HeadCommit;
  evidenceRevision: number;
  pendingEvidenceCount: number;
};

export function GraphHeader({
  projectId,
  title,
  timeZone,
  windowStart,
  T,
  explicitT,
  head,
  pendingEvidenceCount,
}: Props) {
  const router = useRouter();
  const localT = createTimeScale({ timeZone, windowStart }, 1).localStamp(T).replace(' ', 'T');
  const [value, setValue] = useState(localT);
  const navigate = (t: string | null) => {
    const search = new URLSearchParams(window.location.search);
    if (t === null) search.delete('t');
    else search.set('t', t);
    router.push(`?${search.toString()}`);
  };
  const commit = (event?: FormEvent) => {
    event?.preventDefault();
    const [date, time] = value.split('T');
    if (value === localT || !date || !time) return;
    try {
      navigate(zonedInstant(date, time.slice(0, 5), timeZone));
    } catch {
      setValue(localT);
    }
  };
  return (
    <>
      <header className="topbar">
        <div className="proj">
          <b>{title}</b>
          <small>Time zone {timeZone}</small>
        </div>
        <span className="sp" />
        {pendingEvidenceCount > 0 && (
          <Link className="pill" href={`/projects/${projectId}/review?tab=records`}>
            {pendingEvidenceCount} new {pendingEvidenceCount === 1 ? 'record' : 'records'} to review
          </Link>
        )}
      </header>
      <div className="status head">
        <span className="badge b-main" data-testid="main-badge">
          Approved graph
        </span>
        <span>
          <span className="k">
            Last change {head.at}
            {head.by ? ` by ${head.by}` : ''} ·{' '}
          </span>
          <Link className="activity-link" href={`/projects/${projectId}/history`}>
            <svg
              className="ic"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M12 7v5l4 2" />
            </svg>
            Activity
          </Link>
          <span className="sr" title={head.id} data-testid="head-commit">
            {head.id}
          </span>
        </span>
        <span style={{ flex: 1 }} />
        <form className="tctl" onSubmit={commit}>
          <label htmlFor="evaluate-at">As of</label>
          <input
            id="evaluate-at"
            type="datetime-local"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => commit()}
            aria-label="Evaluation time T"
          />
          {explicitT && (
            <button
              type="button"
              className="btn btn-quiet"
              style={{ padding: '2px 6px', fontSize: 12 }}
              onClick={() => navigate(null)}
            >
              Reset
            </button>
          )}
        </form>
      </div>
    </>
  );
}
