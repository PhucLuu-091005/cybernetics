import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { knownScopes, type AgentToken } from '../../contracts';
import { AppError } from '../errors';
import type { HttpIdentityStore, Membership, StoredToken } from '../http/identity-store';
import {
  agentTokens,
  projects,
  trackerMembers,
  trackerTeamMembers,
  trackerTeams,
  users,
  workspaceMembers,
  workspaces,
} from './schema';
import {
  isId,
  isUniqueViolation,
  projectOpenTo,
  toIso,
  withTransaction,
  type Db,
  type Tx,
} from './tx';
export type UserCreatedHook = (
  tx: Tx,
  ctx: { userId: string; workspaceId: string },
) => Promise<void>;
/** An invite to this email becomes the person's member; a person who was removed from that project gets their old member back. */
async function linkInvites(
  tx: Tx,
  user: { id: string; name: string; email: string | null },
): Promise<void> {
  const email = user.email?.trim().toLowerCase();
  if (!email) return;
  const invites = await tx
    .select()
    .from(trackerMembers)
    .where(
      and(
        isNull(trackerMembers.userId),
        isNull(trackerMembers.removedAt),
        eq(trackerMembers.email, email),
      ),
    )
    .for('update');
  for (const invite of invites) {
    const [old] = await tx
      .select()
      .from(trackerMembers)
      .where(
        and(eq(trackerMembers.projectId, invite.projectId), eq(trackerMembers.userId, user.id)),
      )
      .limit(1);
    if (!old) {
      await tx
        .update(trackerMembers)
        .set({ userId: user.id, name: user.name })
        .where(eq(trackerMembers.id, invite.id));
    } else if (old.removedAt !== null) {
      // Change requests and history name the old member, so it comes back instead of the invite.
      const project = invite.projectId;
      const teams = await tx
        .select()
        .from(trackerTeamMembers)
        .where(
          and(
            eq(trackerTeamMembers.projectId, project),
            eq(trackerTeamMembers.memberId, invite.id),
          ),
        );
      if (teams.length)
        await tx
          .insert(trackerTeamMembers)
          .values(teams.map((row) => ({ ...row, memberId: old.id })))
          .onConflictDoNothing();
      await tx
        .delete(trackerTeamMembers)
        .where(
          and(
            eq(trackerTeamMembers.projectId, project),
            eq(trackerTeamMembers.memberId, invite.id),
          ),
        );
      await tx
        .update(trackerTeams)
        .set({ leadMemberId: old.id })
        .where(and(eq(trackerTeams.projectId, project), eq(trackerTeams.leadMemberId, invite.id)));
      await tx.delete(trackerMembers).where(eq(trackerMembers.id, invite.id));
      await tx
        .update(trackerMembers)
        .set({
          removedAt: null,
          access: invite.access,
          viewMain: invite.viewMain,
          viewCrs: invite.viewCrs,
          createCrs: invite.createCrs,
          mergeCrs: invite.mergeCrs,
          email,
          name: user.name,
        })
        .where(eq(trackerMembers.id, old.id));
    }
  }
}
/** A project key belongs to its project and workspace; a personal key only to its person. */
function ownedKeys(input: {
  userId: string;
  workspaceId: string;
  projectId: string | null;
}): SQL | null {
  const t = agentTokens;
  if (input.projectId === null)
    return isId(input.userId) ? and(eq(t.userId, input.userId), eq(t.kind, 'personal'))! : null;
  if (![input.userId, input.workspaceId, input.projectId].every(isId)) return null;
  return and(
    eq(t.userId, input.userId),
    eq(t.workspaceId, input.workspaceId),
    eq(t.projectId, input.projectId),
    eq(t.kind, 'project'),
  )!;
}
export class DbIdentityStore implements HttpIdentityStore {
  constructor(
    private readonly db: Db,
    private readonly options: { onUserCreated?: UserCreatedHook } = {},
  ) {}
  /** ON CONFLICT serializes concurrent first sign-ins on users.subject; only the inserting transaction creates the workspace. */
  async provisionUser(profile: {
    subject: string;
    email: string | null;
    name: string;
  }): Promise<{ userId: string; created: boolean }> {
    return withTransaction(this.db, async (tx) => {
      const [inserted] = await tx
        .insert(users)
        .values({ subject: profile.subject, email: profile.email, name: profile.name })
        .onConflictDoNothing({ target: users.subject })
        .returning({ id: users.id });
      if (!inserted) {
        const [existing] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.subject, profile.subject))
          .limit(1);
        if (!existing) throw new AppError('CONFLICT', 'User provisioning raced; retry sign-in');
        if (profile.email)
          await tx.update(users).set({ email: profile.email }).where(eq(users.id, existing.id));
        await linkInvites(tx, { id: existing.id, ...profile });
        return { userId: existing.id, created: false };
      }
      const [workspace] = await tx
        .insert(workspaces)
        .values({ name: 'Personal workspace' })
        .returning({ id: workspaces.id });
      await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: inserted.id });
      await this.options.onUserCreated?.(tx, { userId: inserted.id, workspaceId: workspace.id });
      await linkInvites(tx, { id: inserted.id, ...profile });
      return { userId: inserted.id, created: true };
    });
  }
  async resolveSessionUser(
    userId: string,
  ): Promise<{ userId: string; defaultWorkspaceId: string } | null> {
    if (!isId(userId)) return null;
    const [row] = await this.db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(asc(workspaceMembers.createdAt), asc(workspaceMembers.workspaceId))
      .limit(1);
    return row ? { userId, defaultWorkspaceId: row.workspaceId } : null;
  }
  async resolveMembership(userId: string, workspaceId: string): Promise<Membership | null> {
    if (!isId(userId) || !isId(workspaceId)) return null;
    const [row] = await this.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)),
      )
      .limit(1);
    return row ? { userId, workspaceId } : null;
  }
  async resolveProject(
    userId: string,
    projectId: string,
  ): Promise<{ workspaceId: string; projectId: string } | null> {
    if (!isId(userId) || !isId(projectId)) return null;
    const [row] = await this.db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(and(eq(projects.id, projectId), projectOpenTo(userId)))
      .limit(1);
    return row ? { workspaceId: row.workspaceId, projectId } : null;
  }
  async getTokenByHash(hash: string): Promise<StoredToken | null> {
    const [row] = await this.db
      .select()
      .from(agentTokens)
      .where(eq(agentTokens.hash, hash))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      kind: row.kind,
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      prefix: row.prefix,
      scopes: knownScopes(row.scopes),
      hash: row.hash,
      label: row.label,
      idempotencyKey: row.idempotencyKey,
      createdAt: toIso(row.createdAt),
      expiresAt: toIso(row.expiresAt),
      revokedAt: row.revokedAt === null ? null : toIso(row.revokedAt),
      lastUsedAt: row.lastUsedAt === null ? null : toIso(row.lastUsedAt),
      ...(row.requestDigest === null ? {} : { requestDigest: row.requestDigest }),
    };
  }
  async insertToken(token: StoredToken): Promise<void> {
    try {
      await this.db.insert(agentTokens).values({
        id: token.id,
        workspaceId: token.workspaceId,
        projectId: token.projectId,
        kind: token.kind,
        userId: token.userId,
        prefix: token.prefix,
        hash: token.hash,
        label: token.label,
        scopes: token.scopes,
        idempotencyKey: token.idempotencyKey,
        requestDigest: token.requestDigest ?? null,
        createdAt: token.createdAt,
        expiresAt: token.expiresAt,
        revokedAt: token.revokedAt,
        lastUsedAt: token.lastUsedAt,
      });
    } catch (error) {
      if (isUniqueViolation(error, 'agent_tokens_creation_key_unique'))
        throw new AppError('CONFLICT', 'Creation key already used');
      throw error;
    }
  }
  async listTokens(input: {
    userId: string;
    workspaceId: string;
    projectId: string | null;
    offset: number;
    limit: number;
  }): Promise<AgentToken[]> {
    const where = ownedKeys(input);
    if (!where) return [];
    const t = agentTokens;
    const rows = await this.db
      .select({
        id: t.id,
        userId: t.userId,
        kind: t.kind,
        projectId: t.projectId,
        prefix: t.prefix,
        label: t.label,
        scopes: t.scopes,
        createdAt: t.createdAt,
        expiresAt: t.expiresAt,
        revokedAt: t.revokedAt,
        lastUsedAt: t.lastUsedAt,
      })
      .from(t)
      .where(where)
      .orderBy(desc(t.createdAt), desc(t.id))
      .limit(input.limit)
      .offset(input.offset);
    return rows.map((row) => ({
      ...row,
      scopes: knownScopes(row.scopes),
      createdAt: toIso(row.createdAt),
      expiresAt: toIso(row.expiresAt),
      revokedAt: row.revokedAt === null ? null : toIso(row.revokedAt),
      lastUsedAt: row.lastUsedAt === null ? null : toIso(row.lastUsedAt),
    }));
  }
  async touchToken(tokenId: string, at: string): Promise<void> {
    await this.db.update(agentTokens).set({ lastUsedAt: at }).where(eq(agentTokens.id, tokenId));
  }
  async revokeToken(input: {
    userId: string;
    workspaceId: string;
    projectId: string | null;
    tokenId: string;
    revokedAt: string;
    idempotencyKey: string;
  }): Promise<string | null> {
    const where = ownedKeys(input);
    if (!where || !isId(input.tokenId)) return null;
    const [row] = await this.db
      .update(agentTokens)
      .set({
        revokedAt: sql`coalesce(${agentTokens.revokedAt}, ${input.revokedAt}::timestamptz)`,
        revokeKey: sql`coalesce(${agentTokens.revokeKey}, ${input.idempotencyKey})`,
      })
      .where(and(eq(agentTokens.id, input.tokenId), where))
      .returning({ revokedAt: agentTokens.revokedAt });
    return row?.revokedAt ? toIso(row.revokedAt) : null;
  }
}
