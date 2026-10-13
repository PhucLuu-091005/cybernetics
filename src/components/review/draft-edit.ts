'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { GraphOperation, Proposal } from '../../contracts';
import { createDraft, updateDraft, type ApiError, type Basis } from '../inbox/api';

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
    if (!draft) {
      const made = await createDraft(projectId, target.basis, title.slice(0, 200));
      if (!made.ok) { setFailure(made.error); setBusy(false); return false; }
      draft = { id: made.data.id, revision: made.data.revision };
      setCreated(draft);
    }
    const result = await updateDraft(projectId, draft, target.basis.evidenceRevision, operations);
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
