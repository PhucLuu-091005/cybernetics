import { expect, it } from 'vitest';
import {
  CreateAgentTokenInputSchema,
  ListAgentTokensInputSchema,
  ListAgentTokensResultSchema,
} from '../../../src/contracts/identity';
import {
  GetEscalationInputSchema,
  GetEscalationResultSchema,
} from '../../../src/contracts/escalations';
import { DomainErrorSchema } from '../../../src/contracts/primitives';

const id = '10000000-0000-4000-8000-000000000001';
it('accepts the next token-page cursor and bounded requested page size', () => {
  const result = ListAgentTokensResultSchema.parse({
    projectId: id,
    items: [],
    nextCursor: 'token-page-2',
    requestId: 'req',
  });
  const input = ListAgentTokensInputSchema.safeParse({
    projectId: id,
    cursor: result.nextCursor,
    limit: 25,
  });
  expect(input.success).toBe(true);
  expect(
    ListAgentTokensInputSchema.safeParse({ projectId: id, cursor: result.nextCursor, limit: 51 })
      .success,
  ).toBe(false);
});
it('accepts the next escalation-analysis cursor and bounded requested page size', () => {
  const escalation = {
    id,
    projectId: id,
    complaint: 'Mapping is late',
    author: { kind: 'user', userId: 'user_clerk' },
    createdAt: '2026-10-12T02:00:00Z',
    latestAnalysisRevision: null,
  };
  const result = GetEscalationResultSchema.parse({
    projectId: id,
    escalation,
    analyses: [],
    mainCommitId: id,
    evidenceRevision: 0,
    stale: false,
    nextCursor: 'analysis-page-2',
    requestId: 'req',
  });
  const input = GetEscalationInputSchema.safeParse({
    projectId: id,
    escalationId: id,
    cursor: result.nextCursor,
    limit: 25,
  });
  expect(input.success).toBe(true);
  expect(
    GetEscalationInputSchema.safeParse({
      projectId: id,
      escalationId: id,
      cursor: result.nextCursor,
      limit: 51,
    }).success,
  ).toBe(false);
});
it('requires a bounded retry key for token creation', () => {
  const input = { projectId: id, label: 'Desktop agent' };
  expect(CreateAgentTokenInputSchema.safeParse(input).success).toBe(false);
  expect(
    CreateAgentTokenInputSchema.safeParse({ ...input, idempotencyKey: 'create-token-1' }).success,
  ).toBe(true);
  expect(CreateAgentTokenInputSchema.safeParse({ ...input, idempotencyKey: '' }).success).toBe(
    false,
  );
  expect(
    CreateAgentTokenInputSchema.safeParse({ ...input, idempotencyKey: 'k'.repeat(257) }).success,
  ).toBe(false);
});
it('carries optional error details and the INTERNAL code in the error envelope', () => {
  expect(
    DomainErrorSchema.parse({
      code: 'CONFLICT',
      message: 'Main moved',
      details: { actualMainCommitId: id },
      requestId: 'req',
    }).details,
  ).toEqual({ actualMainCommitId: id });
  expect(
    DomainErrorSchema.safeParse({ code: 'INTERNAL', message: 'Internal error', requestId: 'req' })
      .success,
  ).toBe(true);
  expect(
    DomainErrorSchema.safeParse({
      code: 'CONFLICT',
      message: 'Main moved',
      extra: 1,
      requestId: 'req',
    }).success,
  ).toBe(false);
});
