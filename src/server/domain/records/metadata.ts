import { and, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { FieldError, QuotedRange, RecordVersion } from '../../../contracts';
import { AppError } from '../../errors';
import { graphCommits, recordVersions, records } from '../../db/schema';
import { isId, toIso, type Db, type ProjectRow, type Tx } from '../../db/tx';

export type EvidenceRecord = {
  recordVersionId: string;
  projectId: string;
  recordId: string;
  occurredAt: string;
  bodyText: string | null;
  digest: string;
  withdrawn: boolean;
  quotedRanges: QuotedRange[];
  superseded: boolean;
};
export type VersionRow = typeof recordVersions.$inferSelect;
export const fieldErrors = (error: z.ZodError): FieldError[] =>
  error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
export function invalid(message: string, error: z.ZodError): AppError {
  return new AppError('VALIDATION', message, { errors: fieldErrors(error) });
}
export async function mainTimeZone(db: Db | Tx, project: ProjectRow): Promise<string> {
  if (project.mainCommitId === null) throw new AppError('INTERNAL', 'Project has no main commit');
  const [row] = await db
    .select({ timeZone: sql<string | null>`${graphCommits.snapshot}->'context'->>'timeZone'` })
    .from(graphCommits)
    .where(and(eq(graphCommits.projectId, project.id), eq(graphCommits.id, project.mainCommitId)))
    .limit(1);
  if (!row?.timeZone) throw new AppError('INTERNAL', 'Main snapshot has no time zone');
  return row.timeZone;
}
export function toRecordVersion(row: VersionRow, withdrawn: boolean): RecordVersion {
  return {
    id: row.id,
    recordId: row.recordId,
    projectId: row.projectId,
    source: row.source,
    sourceLabel: row.sourceLabel,
    externalId: row.externalId,
    threadExternalId: row.threadExternalId,
    parentExternalId: row.parentExternalId,
    title: row.title,
    bodyText: withdrawn ? '' : row.bodyText,
    digest: row.digest,
    occurredAt: toIso(row.occurredAt),
    occurredDate: row.occurredDate,
    occurredTimeZone: row.occurredTimeZone,
    timePrecision: row.timePrecision,
    author: row.author,
    recipients: row.recipients,
    quotedRanges: row.quotedRanges,
    attachmentNames: row.attachmentNames,
    permalink: withdrawn ? null : row.permalink,
    provenance: row.provenance,
    withdrawn,
  };
}
export async function loadRecordMetadata(
  db: Db | Tx,
  projectId: string,
  versionIds: string[],
): Promise<Map<string, EvidenceRecord>> {
  const ids = [...new Set(versionIds.filter(isId))];
  if (!isId(projectId) || !ids.length) return new Map();
  const rows = await db
    .select({
      version: recordVersions,
      currentVersionId: records.currentVersionId,
      withdrawnAt: records.withdrawnAt,
    })
    .from(recordVersions)
    .innerJoin(
      records,
      and(eq(records.projectId, recordVersions.projectId), eq(records.id, recordVersions.recordId)),
    )
    .where(and(eq(recordVersions.projectId, projectId), inArray(recordVersions.id, ids)));
  return new Map(
    rows.map(({ version, currentVersionId, withdrawnAt }) => {
      const withdrawn = withdrawnAt !== null;
      return [
        version.id,
        {
          recordVersionId: version.id,
          projectId: version.projectId,
          recordId: version.recordId,
          occurredAt: toIso(version.occurredAt),
          bodyText: withdrawn ? null : version.bodyText,
          digest: version.digest,
          withdrawn,
          quotedRanges: version.quotedRanges,
          superseded: currentVersionId !== version.id,
        },
      ];
    }),
  );
}
