'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Project } from '../../contracts';
import { send, type ApiError } from './api';
import { ConflictBanner } from './ConflictBanner';
import {
  CLIENT_MAX,
  DEFAULT_TEAMS,
  NAME_MAX,
  newProjectBody,
  newProjectProblem,
  type NewProjectForm,
} from './new-project';

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<NewProjectForm>({
    name: '',
    client: '',
    teams: DEFAULT_TEAMS,
    milestoneName: '',
    milestoneDate: '',
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const body = newProjectBody(form);
  const problem = newProjectProblem(form);
  const edit = (field: keyof NewProjectForm) => (event: { target: { value: string } }) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [field]: value }));
  };
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
    dialog.current?.close();
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
            value={form.name}
            required
            maxLength={NAME_MAX}
            autoComplete="off"
            onChange={edit('name')}
          />
        </label>
        <label className="field">
          Client
          <input
            value={form.client}
            required
            maxLength={CLIENT_MAX}
            autoComplete="off"
            onChange={edit('client')}
          />
        </label>
        <label className="field">
          Teams, one per line
          <textarea
            value={form.teams}
            rows={3}
            required
            autoComplete="off"
            onChange={edit('teams')}
          />
        </label>
        <div className="grid2">
          <label className="field">
            First milestone (optional)
            <input
              value={form.milestoneName}
              maxLength={NAME_MAX}
              autoComplete="off"
              onChange={edit('milestoneName')}
            />
          </label>
          <label className="field">
            Milestone date
            <input type="date" value={form.milestoneDate} onChange={edit('milestoneDate')} />
          </label>
        </div>
        {problem && (
          <p className="new-project-problem" role="status">
            {problem}
          </p>
        )}
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
