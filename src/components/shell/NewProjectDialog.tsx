'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Project } from '../../contracts';
import { send, type ApiError } from '../inbox/api';
import { ConflictBanner } from '../review/ConflictBanner';
import { CLIENT_MAX, NAME_MAX, newProjectBody } from './new-project';

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const body = newProjectBody(name, client);
  useEffect(() => {
    dialog.current?.showModal();
    nameInput.current?.focus();
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!body || busy) return;
    setBusy(true);
    setFailure(null);
    const result = await send<Project>('/api/v1/projects', 'POST', body);
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    router.push(`/projects/${result.data.id}/graph`);
    router.refresh();
    onClose();
  };
  return (
    <dialog
      ref={dialog}
      className="new-project"
      aria-labelledby="new-project-title"
      onCancel={(event) => busy && event.preventDefault()}
      onClose={onClose}
      // The graph shortcuts listen on the document and must not act on keys typed in this dialog.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form onSubmit={submit}>
        <h2 id="new-project-title">New project</h2>
        {failure && <ConflictBanner title="The project was not created." error={failure} />}
        <label className="field">
          Project name
          <input
            ref={nameInput}
            value={name}
            required
            maxLength={NAME_MAX}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          Client
          <input
            value={client}
            required
            maxLength={CLIENT_MAX}
            autoComplete="off"
            onChange={(event) => setClient(event.target.value)}
          />
        </label>
        <div className="new-project-actions">
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button className="btn btn-ink" type="submit" disabled={!body || busy}>
            Create project
          </button>
        </div>
      </form>
    </dialog>
  );
}
