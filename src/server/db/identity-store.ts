import { and, asc, eq, sql } from 'drizzle-orm';
import { AppError } from '../errors';
import type { HttpIdentityStore, Membership, StoredToken } from '../http/identity-store';
import { agentTokens, projects, users, workspaceMembers, workspaces } from './schema';
import { isId, isUniqueViolation, toIso, withTransaction, type Db, type Tx } from './tx';
export type UserCreatedHook = (tx: Tx, ctx: { userId: string; workspaceId: string }) => Promise<void>;
export class DbIdentityStore implements HttpIdentityStore {
  constructor(private readonly db: Db, private readonly options: { onUserCreated?: UserCreatedHook } = {}) {}
  /** ON CONFLICT serializes concurrent first sign-ins on users.subject; only the inserting transaction creates the workspace. */
  async provisionUser(profile: { subject: string; email: string | null; name: string }): Promise<{ userId: string; created: boolean }> {
    return withTransaction(this.db, async tx => {
      const [inserted] = await tx.insert(users).values({ subject: profile.subject, email: profile.email, name: profile.name }).onConflictDoNothing({ target: users.subject }).returning({ id: users.id });
      if (!inserted) {
        const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.subject, profile.subject)).limit(1);
        if (!existing) throw new AppError('CONFLICT', 'User provisioning raced; retry sign-in');
        return { userId: existing.id, created: false };
      }
      const [workspace] = await tx.insert(workspaces).values({ name: 'Personal workspace' }).returning({ id: workspaces.id });
      await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: inserted.id });
      await this.options.onUserCreated?.(tx, { userId: inserted.id, workspaceId: workspace.id });
      return { userId: inserted.id, created: true };
    });
  }
  async resolveSessionUser(userId: string): Promise<{ userId: string; defaultWorkspaceId: string } | null> {
    if (!isId(userId)) return null;
    const [row] = await this.db.select({ workspaceId: workspaceMembers.workspaceId }).from(workspaceMembers).where(eq(workspaceMembers.userId, userId)).orderBy(asc(workspaceMembers.createdAt), asc(workspaceMembers.workspaceId)).limit(1);
    return row ? { userId, defaultWorkspaceId: row.workspaceId } : null;
  }
  async resolveMembership(userId: string, workspaceId: string): Promise<Membership | null> {
    if (!isId(userId) || !isId(workspaceId)) return null;
    const [row] = await this.db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId))).limit(1);
    return row ? { userId, workspaceId } : null;
  }
  async resolveProject(userId: string, projectId: string): Promise<{ workspaceId: string; projectId: string } | null> {
    if (!isId(userId) || !isId(projectId)) return null;
    const [row] = await this.db.select({ workspaceId: projects.workspaceId }).from(projects)
      .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, projects.workspaceId), eq(workspaceMembers.userId, userId)))
      .where(eq(projects.id, projectId)).limit(1);
    return row ? { workspaceId: row.workspaceId, projectId } : null;
  }
  async getTokenByHash(hash: string): Promise<StoredToken | null> {
    const [row] = await this.db.select().from(agentTokens).where(eq(agentTokens.hash, hash)).limit(1);
    if (!row) return null;
    return {
      id: row.id, userId: row.userId, projectId: row.projectId, workspaceId: row.workspaceId, prefix: row.prefix, scopes: row.scopes, hash: row.hash, label: row.label, idempotencyKey: row.idempotencyKey,
      createdAt: toIso(row.createdAt), expiresAt: toIso(row.expiresAt), revokedAt: row.revokedAt === null ? null : toIso(row.revokedAt),
      ...(row.requestDigest === null ? {} : { requestDigest: row.requestDigest }),
    };
  }
  async insertToken(token: StoredToken): Promise<void> {
    try {
      await this.db.insert(agentTokens).values({ id: token.id, workspaceId: token.workspaceId, projectId: token.projectId, userId: token.userId, prefix: token.prefix, hash: token.hash, label: token.label, scopes: token.scopes, idempotencyKey: token.idempotencyKey, requestDigest: token.requestDigest ?? null, createdAt: token.createdAt, expiresAt: token.expiresAt, revokedAt: token.revokedAt });
    } catch (error) {
      if (isUniqueViolation(error, 'agent_tokens_creation_key_unique')) throw new AppError('CONFLICT', 'Creation key already used');
      throw error;
    }
  }
  async revokeToken(input: { userId: string; workspaceId: string; projectId: string; tokenId: string; revokedAt: string; idempotencyKey: string }): Promise<string | null> {
    if (![input.userId, input.workspaceId, input.projectId, input.tokenId].every(isId)) return null;
    const [row] = await this.db.update(agentTokens)
      .set({ revokedAt: sql`coalesce(${agentTokens.revokedAt}, ${input.revokedAt}::timestamptz)`, revokeKey: sql`coalesce(${agentTokens.revokeKey}, ${input.idempotencyKey})` })
      .where(and(eq(agentTokens.id, input.tokenId), eq(agentTokens.userId, input.userId), eq(agentTokens.workspaceId, input.workspaceId), eq(agentTokens.projectId, input.projectId)))
      .returning({ revokedAt: agentTokens.revokedAt });
    return row?.revokedAt ? toIso(row.revokedAt) : null;
  }
}
