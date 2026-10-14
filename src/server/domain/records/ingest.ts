import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  IngestEnvelopeSchema,
  RecordInputSchema,
  type ActorContext,
  type ActorReference,
  type IngestEnvelope,
  type IngestItemResult,
  type IngestReceipt,
  type SourceKind,
} from '../../../contracts';
import { AppError } from '../../errors';
import { actorKey, withReceipt } from '../../db/receipts';
import { projects, recordVersions, records } from '../../db/schema';
import { lockProject, withTransaction, type Db, type Tx } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { fieldErrors, invalid, mainTimeZone } from './metadata';
import { foldForSearch, normalizeRecord, recordDigest, type NormalizedRecord } from './normalize';

type Stored = {
  workspaceId: string;
  projectId: string;
  source: SourceKind;
  evidenceRevision: number;
  actor: ActorReference;
  importedAt: string;
};
type Decision = Exclude<IngestItemResult, { decision: 'invalid' }>;

async function insertVersion(
  tx: Tx,
  stored: Stored,
  recordId: string,
  versionNo: number,
  n: NormalizedRecord,
  digest: string,
): Promise<string> {
  const id = randomUUID();
  await tx.insert(recordVersions).values({
    id,
    workspaceId: stored.workspaceId,
    projectId: stored.projectId,
    recordId,
    versionNo,
    digest,
    source: stored.source,
    ...n,
    searchText: `${foldForSearch(n.title)}\n${foldForSearch(n.bodyText)}`,
    searchTitle: foldForSearch(n.title),
    provenance: { actor: stored.actor, importedAt: stored.importedAt },
    evidenceRevision: stored.evidenceRevision,
  });
  return id;
}
async function ingestOne(
  tx: Tx,
  stored: Stored,
  n: NormalizedRecord,
  index: number,
): Promise<Decision> {
  const digest = recordDigest(n);
  if (n.externalId === null) {
    const [same] = await tx
      .select({ recordId: recordVersions.recordId, id: recordVersions.id })
      .from(recordVersions)
      .where(
        and(
          eq(recordVersions.projectId, stored.projectId),
          eq(recordVersions.source, stored.source),
          eq(recordVersions.digest, digest),
        ),
      )
      .orderBy(recordVersions.createdAt, recordVersions.id)
      .limit(1);
    if (same)
      return { index, decision: 'duplicate', recordId: same.recordId, recordVersionId: same.id };
  } else {
    const [existing] = await tx
      .select({
        id: records.id,
        currentVersionId: records.currentVersionId,
        digest: recordVersions.digest,
      })
      .from(records)
      .leftJoin(
        recordVersions,
        and(
          eq(recordVersions.projectId, records.projectId),
          eq(recordVersions.id, records.currentVersionId),
        ),
      )
      .where(
        and(
          eq(records.projectId, stored.projectId),
          eq(records.source, stored.source),
          eq(records.externalId, n.externalId),
        ),
      )
      .limit(1);
    if (existing?.currentVersionId && existing.digest === digest)
      return {
        index,
        decision: 'duplicate',
        recordId: existing.id,
        recordVersionId: existing.currentVersionId,
      };
    if (existing) {
      const [last] = await tx
        .select({ versionNo: recordVersions.versionNo })
        .from(recordVersions)
        .where(eq(recordVersions.recordId, existing.id))
        .orderBy(desc(recordVersions.versionNo))
        .limit(1);
      const versionId = await insertVersion(
        tx,
        stored,
        existing.id,
        (last?.versionNo ?? 0) + 1,
        n,
        digest,
      );
      await tx
        .update(records)
        .set({ currentVersionId: versionId })
        .where(and(eq(records.projectId, stored.projectId), eq(records.id, existing.id)));
      return { index, decision: 'new_version', recordId: existing.id, recordVersionId: versionId };
    }
  }
  const recordId = randomUUID();
  await tx.insert(records).values({
    id: recordId,
    workspaceId: stored.workspaceId,
    projectId: stored.projectId,
    source: stored.source,
    externalId: n.externalId,
  });
  const versionId = await insertVersion(tx, stored, recordId, 1, n, digest);
  await tx
    .update(records)
    .set({ currentVersionId: versionId })
    .where(and(eq(records.projectId, stored.projectId), eq(records.id, recordId)));
  return { index, decision: 'new', recordId, recordVersionId: versionId };
}

export async function ingestRecords(
  db: Db,
  ctx: ActorContext,
  input: IngestEnvelope,
): Promise<IngestReceipt> {
  requireScope(ctx, 'records:import');
  const parsed = IngestEnvelopeSchema.safeParse(input);
  if (!parsed.success) throw invalid('Invalid import batch', parsed.error);
  const envelope = parsed.data;
  return withTransaction(db, async (tx) => {
    const project = await lockProject(tx, ctx, envelope.projectId);
    const mainCommitId = project.mainCommitId;
    if (mainCommitId === null) throw new AppError('INTERNAL', 'Project has no main commit');
    return withReceipt(
      tx,
      {
        projectId: project.id,
        actorKey: actorKey(ctx),
        operation: `import:${envelope.source}`,
        idempotencyKey: envelope.idempotencyKey,
        input: envelope,
      },
      async () => {
        const timeZone = await mainTimeZone(tx, project);
        const stored: Stored = {
          workspaceId: project.workspaceId,
          projectId: project.id,
          source: envelope.source,
          evidenceRevision: project.evidenceRevision + 1,
          actor:
            ctx.kind === 'agent'
              ? { kind: 'agent', userId: ctx.userId, tokenId: ctx.tokenId }
              : { kind: 'user', userId: ctx.userId },
          importedAt: new Date().toISOString(),
        };
        const items: IngestItemResult[] = [];
        for (const [index, raw] of envelope.records.entries()) {
          const item = RecordInputSchema.safeParse(
            raw !== null && typeof raw === 'object' && !Array.isArray(raw)
              ? { sourceLabel: envelope.sourceLabel, ...raw }
              : raw,
          );
          if (!item.success) {
            items.push({ index, decision: 'invalid', errors: fieldErrors(item.error) });
            continue;
          }
          let normalized: NormalizedRecord;
          try {
            normalized = normalizeRecord(item.data, timeZone);
          } catch (error) {
            if (
              !(error instanceof AppError) ||
              error.code !== 'VALIDATION' ||
              !error.extras.errors?.length
            )
              throw error;
            items.push({ index, decision: 'invalid', errors: error.extras.errors });
            continue;
          }
          items.push(await ingestOne(tx, stored, normalized, index));
        }
        const changed = items.some(
          (item) => item.decision === 'new' || item.decision === 'new_version',
        );
        if (changed)
          await tx
            .update(projects)
            .set({ evidenceRevision: sql`${projects.evidenceRevision} + 1` })
            .where(eq(projects.id, project.id));
        return {
          projectId: project.id,
          requestId: ctx.requestId,
          evidenceRevision: changed ? stored.evidenceRevision : project.evidenceRevision,
          mainCommitId,
          items,
          idempotencyKey: envelope.idempotencyKey,
        };
      },
    );
  });
}
