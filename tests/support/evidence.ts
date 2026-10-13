import { eq } from 'drizzle-orm';
import type { IngestEnvelope, RecordInput } from '../../src/contracts';
import { graphCommits, projects, recordVersions } from '../../src/server/db/schema';
import type { Db } from '../../src/server/db/tx';

export function record(externalId: string, bodyText: string): RecordInput {
  return { externalId, sourceLabel: 'Paste', author: { name: 'Sarah Kim', email: 'sarah@example.com' }, recipients: [{ name: 'Minh Tran' }], title: `Message ${externalId}`, bodyText, occurredAt: '2026-10-01T09:00:00+07:00' };
}
export function envelopeFor(projectId: string, records: unknown[], idempotencyKey: string): IngestEnvelope {
  return { projectId, source: 'paste', sourceLabel: 'Paste', records: records as IngestEnvelope['records'], idempotencyKey };
}
export async function projectRow(db: Db, projectId: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
  return row;
}
export async function mainSnapshotJson(db: Db, projectId: string): Promise<string> {
  const row = await projectRow(db, projectId);
  const commits = await db.select().from(graphCommits).where(eq(graphCommits.projectId, projectId)).orderBy(graphCommits.sequence);
  return JSON.stringify({ mainCommitId: row.mainCommitId, commits });
}
export async function versionCount(db: Db, externalId: string): Promise<number> {
  return (await db.select({ id: recordVersions.id }).from(recordVersions).where(eq(recordVersions.externalId, externalId))).length;
}
