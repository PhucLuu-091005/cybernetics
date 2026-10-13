import type { FieldError, GraphOperation, Proposal } from '../../contracts';

export type ApiError = { status: number; code: string; message: string; errors?: FieldError[]; details?: Record<string, unknown> };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };
/** What the page displayed; every mutation sends it so a concurrent change answers CONFLICT instead of overwriting. */
export type Basis = { mainCommitId: string; evidenceRevision: number };

export async function send<T>(path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try { response = await fetch(path, method === 'GET' ? { headers: { Accept: 'application/json' } } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { return { ok: false, error: { status: 0, code: 'NETWORK', message: 'The request did not reach the server. Try again.' } }; }
  const data = await response.json().catch(() => null);
  if (response.ok) return { ok: true, data: data as T };
  const error = data && typeof data === 'object' ? data as Partial<ApiError> : {};
  return { ok: false, error: { status: response.status, code: error.code ?? 'INTERNAL', message: error.message ?? `Request failed with status ${response.status}`, ...(error.errors ? { errors: error.errors } : {}), ...(error.details && typeof error.details === 'object' ? { details: error.details } : {}) } };
}

export const createDraft = (projectId: string, basis: Basis, title: string) =>
  send<Proposal>(`/api/v1/projects/${projectId}/proposals`, 'POST', { baseCommitId: basis.mainCommitId, title, rationale: '', expectedEvidenceRevision: basis.evidenceRevision, idempotencyKey: crypto.randomUUID() });

export const updateDraft = (projectId: string, proposal: { id: string; revision: number }, evidenceRevision: number, operations: GraphOperation[]) =>
  send<Proposal>(`/api/v1/projects/${projectId}/proposals/${proposal.id}`, 'PATCH', { expectedProposalRevision: proposal.revision, expectedEvidenceRevision: evidenceRevision, operations, idempotencyKey: crypto.randomUUID() });
