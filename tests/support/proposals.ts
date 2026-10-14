import { randomUUID } from 'node:crypto';
import type { ActorContext, Act, GraphOperation } from '../../src/contracts';
import { createProject, emptySnapshot } from '../../src/server/domain/projects';
import { ingestRecords } from '../../src/server/domain/records';
import type { Db } from '../../src/server/db/tx';
import { envelopeFor, record } from './evidence';

export const proposalIds = {
  department: '40000000-0000-4000-8000-000000000001',
  loop: '40000000-0000-4000-8000-000000000002',
  act: '40000000-0000-4000-8000-000000000003',
};
export const body = 'Anh Minh ơi 🙏 — Can you confirm the plan? We will go live by 30 September.';
export const quote = 'We will go live by 30 September.';
export const T = '2026-10-09T11:00:00Z';

export async function seedProject(
  db: Db,
  ctx: ActorContext,
): Promise<{ projectId: string; mainId: string; versionId: string }> {
  const snapshot = emptySnapshot();
  snapshot.context.departments = [
    { id: proposalIds.department, name: 'Delivery', side: 'vendor', order: 0 },
  ];
  const project = await createProject(db, ctx, {
    title: 'Fund III',
    clientName: 'Larkspur',
    snapshot,
  });
  const versionId = await ingestText(db, ctx, project.id, body);
  return { projectId: project.id, mainId: project.mainCommitId, versionId };
}
export async function ingestText(
  db: Db,
  ctx: ActorContext,
  projectId: string,
  text: string,
): Promise<string> {
  const receipt = await ingestRecords(
    db,
    ctx,
    envelopeFor(projectId, [record(randomUUID(), text)], randomUUID()),
  );
  const item = receipt.items[0];
  if (item.decision === 'invalid') throw new Error('Seed record is invalid');
  return item.recordVersionId;
}
export function putLoop(title = 'Confirm go-live', id = proposalIds.loop): GraphOperation {
  return {
    op: 'put',
    collection: 'loops',
    value: {
      id,
      title,
      customer: { kind: 'side', side: 'client' },
      performer: { kind: 'side', side: 'vendor' },
      performerDepartmentId: proposalIds.department,
      milestoneId: null,
    },
  };
}
/** Offsets always locate the canonical quote, so a different submitted quote must fail verification. */
export function putAct(
  versionId: string,
  submitted: string,
  overrides: Partial<Act> = {},
): GraphOperation {
  const start = body.indexOf(quote);
  return {
    op: 'put',
    collection: 'acts',
    quote: submitted,
    value: {
      id: proposalIds.act,
      citation: { recordVersionId: versionId, start, end: start + quote.length },
      type: 'request',
      actor: { kind: 'side', side: 'client' },
      customer: { kind: 'side', side: 'client' },
      performer: { kind: 'side', side: 'vendor' },
      action: 'Confirm the go-live date',
      due: null,
      hedged: false,
      loopId: proposalIds.loop,
      hidden: false,
      origin: 'human',
      confidence: null,
      ...overrides,
    },
  };
}
