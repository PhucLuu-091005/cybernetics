import { randomUUID } from 'node:crypto';
import { AppError } from '../../../src/server/errors';
import type { HttpIdentityStore, StoredToken } from '../../../src/server/http/identity-store';
export type MemoryStore = HttpIdentityStore & {
  users: Map<string, { id: string; subject: string; defaultWorkspaceId: string }>;
  memberships: Set<string>;
  projects: Map<string, { workspaceId: string }>;
  tokens: Map<string, StoredToken>;
};
export function memoryStore(): MemoryStore {
  const users: MemoryStore['users'] = new Map(), memberships = new Set<string>(), projects: MemoryStore['projects'] = new Map(), tokens = new Map<string, StoredToken>();
  const resolveMembership = async (userId: string, workspaceId: string) => memberships.has(`${userId}:${workspaceId}`) ? { userId, workspaceId } : null;
  return {
    users, memberships, projects, tokens, resolveMembership,
    async provisionUser({ subject }) {
      const existing = [...users.values()].find(user => user.subject === subject);
      if (existing) return { userId: existing.id, created: false };
      const id = randomUUID(), defaultWorkspaceId = randomUUID();
      users.set(id, { id, subject, defaultWorkspaceId }); memberships.add(`${id}:${defaultWorkspaceId}`);
      return { userId: id, created: true };
    },
    async resolveSessionUser(userId) { const user = users.get(userId); return user ? { userId, defaultWorkspaceId: user.defaultWorkspaceId } : null; },
    async resolveProject(userId, projectId) { const project = projects.get(projectId); return project && await resolveMembership(userId, project.workspaceId) ? { workspaceId: project.workspaceId, projectId } : null; },
    async getTokenByHash(hash) { return tokens.get(hash) ?? null; },
    async insertToken(token) {
      if ([...tokens.values()].some(t => t.userId === token.userId && t.projectId === token.projectId && t.idempotencyKey === token.idempotencyKey)) throw new AppError('CONFLICT', 'Creation key already used');
      tokens.set(token.hash, token);
    },
    async listTokens({ userId, workspaceId, projectId, offset, limit }) {
      return [...tokens.values()].filter(t => t.userId === userId && t.workspaceId === workspaceId && t.projectId === projectId).reverse().slice(offset, offset + limit)
        .map(({ id, userId, projectId, prefix, scopes, createdAt, expiresAt, revokedAt }) => ({ id, userId, projectId, prefix, scopes, createdAt, expiresAt, revokedAt }));
    },
    async revokeToken(input) {
      const token = [...tokens.values()].find(t => t.id === input.tokenId && t.userId === input.userId && t.workspaceId === input.workspaceId && t.projectId === input.projectId);
      if (!token) return null;
      token.revokedAt ??= input.revokedAt; return token.revokedAt;
    },
  };
}
