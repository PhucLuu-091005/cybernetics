import type { AgentToken, Scope } from '../../contracts';
export type Membership = { userId: string; workspaceId: string };
export type StoredToken = AgentToken & { workspaceId: string; hash: string; label: string; idempotencyKey: string; requestDigest?: string };
/** All lookups must check ownership/current membership, never trust body-provided scope. */
export interface HttpIdentityStore {
  resolveUser(subject: string): Promise<{ userId: string; workspaceId: string } | null>;
  resolveMembership(userId: string, workspaceId: string): Promise<Membership | null>;
  resolveProject(userId: string, projectId: string): Promise<{ workspaceId: string; projectId: string } | null>;
  getTokenByHash(hash: string): Promise<StoredToken | null>;
  /** Atomically enforce unique(userId, projectId, idempotencyKey); duplicates throw CONFLICT. */
  insertToken(token: StoredToken): Promise<void>;
  revokeToken(input: { userId: string; workspaceId: string; projectId: string; tokenId: string; revokedAt: string; idempotencyKey: string }): Promise<string | null>;
  bootstrapLocalIdentity(identity: { userId: string; workspaceId: string; subject: string }): Promise<void>;
}
export const browserScopes: Scope[] = ['project:read', 'records:import', 'graph:propose', 'graph:merge', 'escalations:write'];
