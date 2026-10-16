import { expect, it } from 'vitest';
import {
  ActorContextSchema,
  CreateAgentTokenInputSchema,
  ScopeSchema,
} from '../../../src/contracts/identity';
import { ProjectSchema } from '../../../src/contracts/project';
import { canonicalHash, canonicalJson } from '../../../src/lib/canonical-json';

const id = '10000000-0000-4000-8000-000000000001';
const actor = {
  kind: 'user',
  userId: 'user_clerk',
  workspaceId: id,
  projectId: null,
  scopes: ['project:read'],
  requestId: 'test',
};

it('defaults tokens to read and queue scopes', () => {
  const parsed = CreateAgentTokenInputSchema.safeParse({
    projectId: id,
    label: 'Desktop agent',
    idempotencyKey: 'default-scope-token',
  });
  expect(parsed.success).toBe(true);
  if (parsed.success) expect(parsed.data.scopes).toEqual(['project:read', 'queue:add']);
});
it('rejects a scope that no tool or route uses', () => {
  for (const scope of ['graph:admin', 'graph:merge', 'graph:propose', 'records:import'])
    expect(ScopeSchema.safeParse(scope).success).toBe(false);
});
it('allows browser bootstrap without a project while keeping agents project bound', () => {
  expect(ActorContextSchema.safeParse(actor).success).toBe(true);
  expect(ActorContextSchema.safeParse({ ...actor, kind: 'agent', tokenId: id }).success).toBe(
    false,
  );
});
it('keeps a project to its title and client name', () => {
  const project = { id, workspaceId: id, title: 'Fund III onboarding', clientName: 'Larkspur' };
  expect(ProjectSchema.parse(project)).toEqual(project);
  expect(ProjectSchema.safeParse({ ...project, mainCommitId: id }).success).toBe(false);
});
it('hashes object keys in canonical order and keeps array order', () => {
  expect(canonicalJson({ '2': 'two', '10': 'ten' })).toBe('{"10":"ten","2":"two"}');
  expect(canonicalHash({ b: 2, a: 1 })).toBe(
    '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
  );
  expect(canonicalHash({ scopes: ['project:read', 'queue:add'] })).not.toBe(
    canonicalHash({ scopes: ['queue:add', 'project:read'] }),
  );
});
