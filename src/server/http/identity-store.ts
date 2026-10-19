import { ScopeSchema, type AgentToken, type Scope } from '../../contracts';
export type Membership = { userId: string; workspaceId: string };
export type StoredToken = AgentToken & {
  workspaceId: string;
  /** The project of the member the key acts as (`actsAs`). */
  memberProjectId?: string;
  hash: string;
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
  /** Returns the project's workspace only while the user may open it: through the workspace, or through a project member that is not removed. */
  resolveProject(
    userId: string,
    projectId: string,
  ): Promise<{ workspaceId: string; projectId: string } | null>;
  getTokenByHash(hash: string): Promise<StoredToken | null>;
  /** Atomically enforce unique(userId, projectId, idempotencyKey); duplicates throw CONFLICT. */
  insertToken(token: StoredToken): Promise<void>;
  /** Newest first; never exposes hashes or creation keys. A null projectId lists the personal keys. */
  listTokens(input: {
    userId: string;
    workspaceId: string;
    projectId: string | null;
    offset: number;
    limit: number;
  }): Promise<AgentToken[]>;
  /** Called on every authenticated agent call; the caller limits it to once a minute. */
  touchToken(tokenId: string, at: string): Promise<void>;
  revokeToken(input: {
    userId: string;
    workspaceId: string;
    projectId: string | null;
    tokenId: string;
    revokedAt: string;
    idempotencyKey: string;
  }): Promise<string | null>;
}
/** A person in the browser holds every scope; their member rights decide what they can do. */
export const browserScopes: Scope[] = [...ScopeSchema.options];
