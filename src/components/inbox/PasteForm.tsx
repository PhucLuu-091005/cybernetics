'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import type { IngestReceipt } from '../../contracts';
import { zonedInstant } from '../../lib/calendar';
import { send, type ApiError } from './api';
import { inboxHref } from './links';

const DECISION_TEXT = { new: 'new, now pending', duplicate: 'duplicate, already imported', new_version: 'new version, now pending' } as const;

function CheckIcon() {
  return <svg className="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
}

const noSubscription = () => () => {};

export function PasteForm({ projectId, timeZone, mainCommitId, proposalId }: { projectId: string; timeZone: string; mainCommitId: string; proposalId: string | null }) {
  const router = useRouter();
  const [form, setForm] = useState({ sourceLabel: 'paste', title: '', author: '', sentAt: '', dateOnly: false, bodyText: '' });
  const [busy, setBusy] = useState(false);
  // Before hydration a click would submit the form natively and reload the page, losing the typed text.
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  const [receipt, setReceipt] = useState<IngestReceipt | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm(current => ({ ...current, [key]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    let occurred: { occurredAt: string } | { occurredDate: string };
    try {
      const [date, time] = form.sentAt.split('T');
      occurred = form.dateOnly ? { occurredDate: date } : { occurredAt: zonedInstant(date, (time ?? '').slice(0, 5), timeZone) };
    } catch {
      setFailure({ status: 400, code: 'VALIDATION', message: 'Enter the date and time the message was sent' });
      return;
    }
    setBusy(true);
    const result = await send<IngestReceipt>(`/api/v1/projects/${projectId}/records`, 'POST', {
      source: 'paste', sourceLabel: form.sourceLabel.trim(), idempotencyKey: crypto.randomUUID(),
      records: [{ title: form.title.trim(), bodyText: form.bodyText, author: { name: form.author.trim() }, recipients: [], ...occurred }],
    });
    setBusy(false);
    if (!result.ok) { setFailure(result.error); return; }
    setReceipt(result.data);
    if (result.data.items.every(item => item.decision !== 'invalid')) setForm(current => ({ ...current, title: '', bodyText: '' }));
    router.refresh();
  };

  return (
    <details className="card" open={receipt !== null || undefined}>
      <summary className="pad" style={{ cursor: 'pointer', fontWeight: 700 }}>Paste a record</summary>
      <form className="pad stack" style={{ paddingTop: 0 }} onSubmit={submit}>
        <p className="guarantee"><CheckIcon />Importing never changes main.</p>
        <label className="field">Source label<input value={form.sourceLabel} onChange={set('sourceLabel')} required maxLength={200} /></label>
        <label className="field">Title<input value={form.title} onChange={set('title')} required maxLength={200} /></label>
        <div className="grid2">
          <label className="field">Author<input value={form.author} onChange={set('author')} required maxLength={200} /></label>
          <label className="field">{form.dateOnly ? 'Sent on' : 'Sent at'}
            <input type={form.dateOnly ? 'date' : 'datetime-local'} value={form.dateOnly ? form.sentAt.slice(0, 10) : form.sentAt} onChange={set('sentAt')} required />
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={form.dateOnly} onChange={event => setForm(current => ({ ...current, dateOnly: event.target.checked }))} />No exact time (date only, {timeZone})</label>
        <label className="field">Message text<textarea value={form.bodyText} onChange={set('bodyText')} required /></label>
        <button className="btn btn-ink" type="submit" disabled={busy || !hydrated}>Import as pending record</button>
        {failure && (
          <div className="banner" role="alert">
            <div><b>The import failed.</b><p style={{ fontSize: 13 }}>{failure.message}</p>{failure.errors?.length ? <ul className="errs">{failure.errors.map(error => <li key={`${error.path}:${error.message}`}>{error.path}: {error.message}</li>)}</ul> : null}</div>
          </div>
        )}
        {receipt && (
          <div role="status" aria-label="Import receipt" className="stack" style={{ fontSize: 13, gap: 4 }}>
            {receipt.items.map(item => item.decision === 'invalid'
              ? <div key={item.index}><span className="bad">Item {item.index + 1}: invalid.</span><ul className="errs">{item.errors.map(error => <li key={`${error.path}:${error.message}`}>{error.path}: {error.message}</li>)}</ul></div>
              : <div key={item.index}><span className="ok">Item {item.index + 1}: {DECISION_TEXT[item.decision]}.</span> <Link href={inboxHref(projectId, { state: 'pending', proposal: proposalId, r: item.recordVersionId })} style={{ color: 'var(--route)' }}>Open record</Link></div>)}
            <div className="faint">
              Evidence revision {receipt.evidenceRevision}. {receipt.mainCommitId === mainCommitId ? 'Main did not change' : 'Main moved since this page loaded, through another merge'} (commit <span className="id">{receipt.mainCommitId.slice(0, 7)}</span>).
            </div>
          </div>
        )}
      </form>
    </details>
  );
}
