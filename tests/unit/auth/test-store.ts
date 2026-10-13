import { HttpError } from '../../../src/server/http/errors';
import type { HttpIdentityStore, StoredToken } from '../../../src/server/http/identity-store';
export class TestIdentityStore implements HttpIdentityStore {
  identities = new Map<string, { userId: string; workspaceId: string }>();
  memberships = new Set<string>();
  projects = new Map<string, string>();
  tokens = new Map<string, StoredToken>();
  async resolveUser(subject: string) { return this.identities.get(subject) ?? null; }
  async resolveMembership(userId: string, workspaceId: string) { return this.memberships.has(`${userId}:${workspaceId}`) ? { userId, workspaceId } : null; }
  async resolveProject(userId: string, projectId: string) { const workspaceId = this.projects.get(projectId); return workspaceId && await this.resolveMembership(userId, workspaceId) ? { workspaceId, projectId } : null; }
  async getTokenByHash(hash: string) { return this.tokens.get(hash) ?? null; }
  async insertToken(token: StoredToken) {
    if ([...this.tokens.values()].some(t => t.userId === token.userId && t.projectId === token.projectId && t.idempotencyKey === token.idempotencyKey)) throw new HttpError('CONFLICT', 'Creation key already used', 409);
    this.tokens.set(token.hash, token);
  }
  async revokeToken(input: { userId: string; workspaceId: string; projectId: string; tokenId: string; revokedAt: string }) {
    const token = [...this.tokens.values()].find(t => t.id === input.tokenId && t.userId === input.userId && t.workspaceId === input.workspaceId && t.projectId === input.projectId);
    if (!token) return null;
    token.revokedAt ??= input.revokedAt; return token.revokedAt;
  }
  async bootstrapLocalIdentity(identity: { userId: string; workspaceId: string; subject: string }) { this.identities.set(identity.subject, identity); this.memberships.add(`${identity.userId}:${identity.workspaceId}`); }
}
