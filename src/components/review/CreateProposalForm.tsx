'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Proposal } from '../../contracts';
import { send, type ApiError, type Basis } from '../inbox/api';
import { ConflictBanner } from './ConflictBanner';
import { useHydrated } from './hydrated';

/** SRD 7.6: a proposal always starts from the main commit and evidence revision the page displayed. */
export function CreateProposalForm({ projectId, basis }: { projectId: string; basis: Basis }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [title, setTitle] = useState('');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setFailure(null);
    const result = await send<Proposal>(`/api/v1/projects/${projectId}/proposals`, 'POST', { baseCommitId: basis.mainCommitId, title: title.trim(), rationale: rationale.trim(), expectedEvidenceRevision: basis.evidenceRevision, idempotencyKey: crypto.randomUUID() });
    setBusy(false);
    if (result.ok) router.push(`/projects/${projectId}/proposals/${result.data.id}`);
    else setFailure(result.error);
  };
  return (
    <form className="card pad stack" aria-label="Create proposal" onSubmit={submit}>
      <h2>Create proposal</h2>
      {failure && <ConflictBanner title={failure.status === 409 ? 'Conflict: main or the evidence moved since this page loaded.' : 'The proposal was not created.'} message={failure.status === 409 ? 'Your title and rationale are kept. Reload, then create the proposal again.' : undefined} error={failure}
        actions={failure.status === 409 ? <button className="btn" type="button" onClick={() => { setFailure(null); router.refresh(); }}>Reload</button> : undefined} />}
      <label className="field">Title<input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="What this proposal changes" /></label>
      <label className="field">Rationale<textarea value={rationale} maxLength={10000} onChange={event => setRationale(event.target.value)} placeholder="Why the graph should change" /></label>
      <div className="row">
        <button className="btn btn-ink" type="submit" disabled={!hydrated || busy || !title.trim()}>Create draft from main</button>
        <span className="faint" style={{ fontSize: 12 }}>The draft copies main {basis.mainCommitId.slice(0, 7)} at evidence revision {basis.evidenceRevision}. Main does not change until a person merges it.</span>
      </div>
    </form>
  );
}
