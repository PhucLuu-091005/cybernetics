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

function LockIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function GraphHeader({
  projectId,
  title,
  clientName,
  timeZone,
  windowStart,
  T,
  explicitT,
  head,
  evidenceRevision,
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
          <small>
            {clientName} project, time zone {timeZone}
          </small>
        </div>
        <span className="sp" />
        <span className="faint" style={{ fontSize: 12 }}>
          Keyboard: Tab moves through milestones then loops, Enter opens, ← → step through acts, Esc
          closes
        </span>
      </header>
      <div className="status head">
        <span className="badge b-main" data-testid="main-badge">
          <LockIcon />
          Main, read-only
        </span>
        <span>
          <span className="k">Head commit </span>
          <span className="id v" title={head.id} data-testid="head-commit">
            {head.id.slice(0, 7)}
          </span>{' '}
          <span className="k">
            {head.verb} {head.at}
            {head.by ? ` by ${head.by}` : ''}
          </span>
        </span>
        <span>
          <span className="k">Evidence revision </span>
          <span className="v">{evidenceRevision}</span>
        </span>
        {pendingEvidenceCount > 0 && (
          <Link className="pill" href={`/projects/${projectId}/inbox`}>
            {pendingEvidenceCount} new {pendingEvidenceCount === 1 ? 'record' : 'records'} awaiting
            review
          </Link>
        )}
        <span style={{ flex: 1 }} />
        <form className="tctl" onSubmit={commit}>
          <label htmlFor="evaluate-at">Evaluate at</label>
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
        <Link className="btn btn-ink" href={`/projects/${projectId}/proposals`}>
          Create proposal
        </Link>
      </div>
    </>
  );
}
