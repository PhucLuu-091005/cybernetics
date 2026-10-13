'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Escalation } from '../../contracts';
import { send, type ApiError } from '../inbox/api';
import { ConflictBanner } from '../review/ConflictBanner';
import { useHydrated } from '../review/hydrated';

/** SRD 9: a person opens the complaint; no analysis starts. An agent or a person saves the analysis later. */
export function ComplaintForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [complaint, setComplaint] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!complaint.trim()) return;
    setBusy(true);
    setFailure(null);
    const result = await send<Escalation>(`/api/v1/projects/${projectId}/escalations`, 'POST', { complaint: complaint.trim(), idempotencyKey: crypto.randomUUID() });
    setBusy(false);
    if (result.ok) router.push(`/projects/${projectId}/escalations/${result.data.id}`);
    else setFailure(result.error);
  };
  return (
    <form className="card pad stack" aria-label="Open complaint" onSubmit={submit}>
      <h2>Open a complaint</h2>
      {failure && <ConflictBanner title="The complaint was not saved." message="Your text is kept." error={failure} />}
      <label className="field">Complaint<textarea value={complaint} maxLength={20000} onChange={event => setComplaint(event.target.value)} placeholder="Paste the client's complaint as they wrote it" /></label>
      <div className="row">
        <button className="btn btn-ink" type="submit" disabled={!hydrated || busy || !complaint.trim()}>Open complaint</button>
        <span className="faint" style={{ fontSize: 12 }}>The app runs no analysis. Your agent saves claims and an answer draft through MCP with the escalations:write scope.</span>
      </div>
    </form>
  );
}
