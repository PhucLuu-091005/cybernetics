import type { AgentToken, Scope } from '../../contracts';
export type Membership = { userId: string; workspaceId: string };
export type StoredToken = AgentToken & {
  workspaceId: string;
  hash: string;
  label: string;
  idempotencyKey: string;
  requestDigest?: string;
};
/** All lookups must check ownership/current membership, never trust body-provided scope. */
export interface HttpIdentityStore {
  /** Creates the user, a personal workspace and its membership in one transaction when the subject is new. */
  provisionUser(profile: {
    subject: string;
    email: string | null;
    name: string;
  }): Promise<{ userId: string; created: boolean }>;
  resolveSessionUser(
    userId: string,
  ): Promise<{ userId: string; defaultWorkspaceId: string } | null>;
  resolveMembership(userId: string, workspaceId: string): Promise<Membership | null>;
  /** Returns the project's workspace only while the user is a member of it. */
  resolveProject(
    userId: string,
    projectId: string,
  ): Promise<{ workspaceId: string; projectId: string } | null>;
  getTokenByHash(hash: string): Promise<StoredToken | null>;
  /** Atomically enforce unique(userId, projectId, idempotencyKey); duplicates throw CONFLICT. */
  insertToken(token: StoredToken): Promise<void>;
  /** Newest first; never exposes hashes or creation keys. */
  listTokens(input: {
    userId: string;
    workspaceId: string;
    projectId: string;
    offset: number;
    limit: number;
  }): Promise<AgentToken[]>;
  revokeToken(input: {
    userId: string;
    workspaceId: string;
    projectId: string;
    tokenId: string;
    revokedAt: string;
    idempotencyKey: string;
  }): Promise<string | null>;
}
export const browserScopes: Scope[] = [
  'project:read',
  'records:import',
  'graph:propose',
  'graph:merge',
  'escalations:write',
];
