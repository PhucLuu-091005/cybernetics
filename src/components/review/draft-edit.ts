'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { GetProjectResult, GraphOperation, Proposal } from '../../contracts';
import { createDraft, send, updateDraft, type ApiError, type Basis } from '../inbox/api';

/** Main is read-only: an edit there first creates a draft from the displayed main, then applies the edit to that draft (SRD 7.4). */
export type EditTarget =
  | { kind: 'main'; basis: Basis }
  | { kind: 'proposal'; basis: Basis; proposalId: string; revision: number; status: Proposal['status'] };

export function useDraftEdit(projectId: string, target: EditTarget) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  // A draft created before a failed update is reused on retry instead of creating another one.
  const [created, setCreated] = useState<{ id: string; revision: number } | null>(null);
  const editable = target.kind === 'main' || target.status === 'draft';

  const apply = async (operations: GraphOperation[], title: string): Promise<boolean> => {
    if (!editable) return false;
    setBusy(true);
    setFailure(null);
    let draft = target.kind === 'proposal' ? { id: target.proposalId, revision: target.revision } : created;
    let evidenceRevision = target.basis.evidenceRevision;
    if (draft && target.kind === 'main') {
      // The failed update may have lost to a concurrent edit or new evidence, so the retry sends what the server holds now.
      const [current, project] = await Promise.all([send<Proposal>(`/api/v1/projects/${projectId}/proposals/${draft.id}`, 'GET'), send<GetProjectResult>(`/api/v1/projects/${projectId}`, 'GET')]);
      if (!current.ok) { setFailure(current.error); setBusy(false); return false; }
      if (!project.ok) { setFailure(project.error); setBusy(false); return false; }
      draft = { id: draft.id, revision: current.data.revision };
      evidenceRevision = project.data.project.evidenceRevision;
    }
    if (!draft) {
      const made = await createDraft(projectId, target.basis, title.slice(0, 200));
      if (!made.ok) { setFailure(made.error); setBusy(false); return false; }
      draft = { id: made.data.id, revision: made.data.revision };
      setCreated(draft);
    }
    const result = await updateDraft(projectId, draft, evidenceRevision, operations);
    setBusy(false);
    if (!result.ok) { setFailure(result.error); return false; }
    setCreated(null);
    const search = new URLSearchParams(window.location.search);
    search.delete('cite');
    if (target.kind === 'main') search.set('proposal', result.data.id);
    search.set('rev', String(result.data.revision));
    const next = `${window.location.pathname}?${search.toString()}`;
    if (target.kind === 'main') router.push(next); else router.replace(next, { scroll: false });
    return true;
  };
  return { apply, busy, failure, editable, clearFailure: () => setFailure(null), reload: () => { setFailure(null); router.refresh(); } };
}
