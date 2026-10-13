import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { SaveEscalationAnalysisInputSchema, type ActorContext, type ClaimInput, type EscalationAnalysis, type FieldError, type GraphSnapshot } from '../../../contracts';
import { canonicalHash } from '../../../lib/canonical-json';
import { AppError } from '../../errors';
import { actorKey, withReceipt } from '../../db/receipts';
import { escalationAnalyses } from '../../db/schema';
import { isId, lockProject, withTransaction, type Db, type Tx } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { actorReference } from '../access';
import { loadCommit } from '../commits/store';
import { toProject } from '../projects';
import { invalid, loadRecordMetadata } from '../records/metadata';
import { assertFitsPage, findEscalation, latestAnalysis, toAnalysis, toEscalation } from './read';
import { assessClaims } from './verdict';

const MARKER_OPEN = '[act:';
const MARKER = /\[act:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/g;

/** Citations resolve against the pinned commit, but withdrawal is judged now: a withdrawn record cannot back a new analysis. */
async function citationErrors(tx: Tx, projectId: string, snapshot: GraphSnapshot, claims: ClaimInput[], answerText: string): Promise<FieldError[]> {
  const errors: FieldError[] = [];
  const acts = new Map(snapshot.acts.map(act => [act.id, act]));
  const cited = new Set(claims.flatMap(claim => [...claim.supportingActIds, ...claim.contradictingActIds]));
  const records = await loadRecordMetadata(tx, projectId, [...cited].flatMap(id => acts.get(id)?.citation.recordVersionId ?? []));
  const claimIds = new Set<string>();
  claims.forEach((claim, index) => {
    if (claimIds.has(claim.id)) errors.push({ path: `claims.${index}.id`, message: 'Duplicate claim ID' });
    claimIds.add(claim.id);
    const supporting = new Set(claim.supportingActIds);
    if (supporting.size !== claim.supportingActIds.length || new Set(claim.contradictingActIds).size !== claim.contradictingActIds.length) errors.push({ path: `claims.${index}`, message: 'An act is cited twice in one set' });
    if (claim.contradictingActIds.some(id => supporting.has(id))) errors.push({ path: `claims.${index}`, message: 'An act cannot both support and contradict one claim' });
    for (const field of ['supportingActIds', 'contradictingActIds'] as const) claim[field].forEach((id, position) => {
      const path = `claims.${index}.${field}.${position}`, act = acts.get(id);
      if (!act) errors.push({ path, message: 'Act is not in the pinned graph commit' });
      else if (act.hidden) errors.push({ path, message: 'Hidden acts cannot be cited' });
      else if (records.get(act.citation.recordVersionId)?.withdrawn !== false) errors.push({ path, message: 'The cited record is withdrawn or missing' });
    });
  });
  const markers = [...answerText.matchAll(MARKER)];
  if (markers.length !== answerText.split(MARKER_OPEN).length - 1 || markers.some(match => !isId(match[1]))) errors.push({ path: 'answerText', message: 'Answer markers must be [act:<lowercase uuid>]' });
  for (const match of markers) if (!cited.has(match[1])) errors.push({ path: 'answerText', message: `Marker ${match[0]} is not cited by any claim` });
  return errors;
}

export async function saveEscalationAnalysis(db: Db, ctx: ActorContext, raw: z.input<typeof SaveEscalationAnalysisInputSchema>): Promise<EscalationAnalysis> {
  requireScope(ctx, 'escalations:write');
  const parsed = SaveEscalationAnalysisInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid escalation analysis', parsed.error);
  const input = parsed.data;
  return withTransaction(db, async tx => {
    const project = await lockProject(tx, ctx, input.projectId);
    const escalation = await findEscalation(tx, project.id, input.escalationId, true);
    return withReceipt(tx, { projectId: project.id, actorKey: actorKey(ctx), operation: 'save_escalation_analysis', idempotencyKey: input.idempotencyKey, input }, async () => {
      const { mainCommitId, evidenceRevision } = toProject(project);
      const latest = await latestAnalysis(tx, project.id, escalation.id), latestRevision = latest?.revision ?? null;
      if (input.expectedMainCommitId !== mainCommitId || input.expectedEvidenceRevision !== evidenceRevision || input.expectedAnalysisRevision !== latestRevision) {
        throw new AppError('CONFLICT', 'The main commit, evidence revision or analysis revision changed', { details: { actualMainCommitId: mainCommitId, actualEvidenceRevision: evidenceRevision, actualAnalysisRevision: latestRevision } });
      }
      const commit = await loadCommit(tx, project.id, input.graphCommitId);
      const errors = await citationErrors(tx, project.id, commit.snapshot, input.claims, input.answerText);
      if (errors.length) throw new AppError('VALIDATION', 'Invalid escalation analysis citations', { errors });
      const claims = assessClaims(input.claims), revision = (latestRevision ?? 0) + 1;
      const contentHash = canonicalHash({ claims, answerText: input.answerText, graphCommitId: commit.id, evidenceRevision });
      const analysis = { id: randomUUID(), escalationId: escalation.id, projectId: project.id, revision, graphCommitId: commit.id, evidenceRevision, claims, answerText: input.answerText, author: actorReference(ctx), contentHash, approval: null };
      assertFitsPage(project, toEscalation(escalation, revision), { ...analysis, createdAt: new Date().toISOString() }, ctx.requestId);
      const [row] = await tx.insert(escalationAnalyses).values({ ...analysis, workspaceId: project.workspaceId }).returning();
      return toAnalysis(row);
    });
  });
}
