import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  CreateAgentTokenInputSchema,
  CreatePersonalKeyInputSchema,
  ListPersonalKeysInputSchema,
  RevokePersonalKeyInputSchema,
  type CreatePersonalKeyInput,
  type KeyKind,
  type RevokePersonalKeyInput,
  DEFAULT_AGENT_SCOPES,
  SCOPE_INFO,
  scopeBlock,
  type Creator,
  ListAgentTokensInputSchema,
  RevokeAgentTokenInputSchema,
  type ActorContext,
  type CreateAgentTokenInput,
  type ListAgentTokensResult,
  type RevokeAgentTokenInput,
  type RevokeAgentTokenResult,
  type TokenCreated,
} from '../../../contracts';
import { canonicalHash } from '../../../lib/canonical-json';
import type { HttpIdentityStore } from '../../http/identity-store';
import { AppError } from '../../errors';
import { decodeCursor, encodeCursor, viewKey } from '../paging';
type CreateInput = Omit<CreateAgentTokenInput, 'scopes'> & {
  scopes?: CreateAgentTokenInput['scopes'];
};
export type ListTokensInput = z.input<typeof ListAgentTokensInputSchema>;
export type ListKeysInput = z.input<typeof ListPersonalKeysInputSchema>;
type CreateKeyInput = Omit<CreatePersonalKeyInput, 'scopes'> & {
  scopes?: CreatePersonalKeyInput['scopes'];
};
/** A seeded person of a demo copy whom the visitor acts as while making a key; the key acts as them. */
export type ActsAs = { memberId: string; name: string; projectId: string };
/**
 * The creator of a token as their member rows say today; a null project asks across all their
 * projects, and `actsAs` asks for that member in their demo copy only.
 */
export type CreatorOf = (
  ctx: ActorContext,
  projectId: string | null,
  actsAs?: ActsAs,
) => Promise<Creator>;

export function createTokenService(
  store: HttpIdentityStore,
  creatorOf: CreatorOf,
  now: () => number = Date.now,
) {
  function requireUser(ctx: ActorContext): asserts ctx is Extract<ActorContext, { kind: 'user' }> {
    if (ctx.kind !== 'user')
      throw new AppError('FORBIDDEN', 'Only browser users can manage tokens');
  }
  async function authorize(ctx: ActorContext, projectId: string): Promise<void> {
    requireUser(ctx);
    const project = await store.resolveProject(ctx.userId, projectId);
    if (
      (ctx.projectId && ctx.projectId !== projectId) ||
      !project ||
      project.workspaceId !== ctx.workspaceId
    )
      throw new AppError('NOT_FOUND', 'Project not found');
  }
  async function issue(
    ctx: ActorContext,
    raw: { scopes?: unknown },
    input: Omit<CreateAgentTokenInput, 'projectId'>,
    projectId: string | null,
    actsAs: ActsAs | undefined,
  ): Promise<TokenCreated> {
    // The same rule as the page: a token never asks for a right its creator lacks. Each call checks again.
    const creator = await creatorOf(ctx, projectId, actsAs);
    const blockOf = (scope: string) =>
      scopeBlock(
        SCOPE_INFO.find((info) => info.scope === scope)!,
        creator,
        projectId === null ? 'personal' : 'project',
      );
    if (raw.scopes === undefined)
      input.scopes = DEFAULT_AGENT_SCOPES.filter((scope) => blockOf(scope) === null);
    if (!input.scopes.length)
      throw new AppError('VALIDATION', 'You cannot give an agent any permission here');
    for (const scope of input.scopes) {
      const reason = blockOf(scope);
      if (reason)
        throw new AppError('VALIDATION', reason, {
          errors: [{ path: 'scopes', message: `${scope}: ${reason}` }],
        });
    }
    const createdAt = new Date(now()).toISOString(),
      expiresAt = input.expiresAt ?? new Date(now() + 30 * 86_400_000).toISOString();
    if (Date.parse(expiresAt) <= now())
      throw new AppError('VALIDATION', 'Token expiry must be in the future');
    const secret = `inv_${randomBytes(32).toString('base64url')}`;
    const kind: KeyKind = projectId === null ? 'personal' : 'project';
    const token = {
      id: randomUUID(),
      userId: ctx.userId,
      kind,
      projectId,
      prefix: secret.slice(0, 8),
      label: input.label,
      scopes: [...new Set(input.scopes)],
      createdAt,
      expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      ...(actsAs ? { actsAs: { memberId: actsAs.memberId, name: actsAs.name } } : {}),
    };
    await store.insertToken({
      ...token,
      hash: createHash('sha256').update(secret).digest('hex'),
      workspaceId: ctx.workspaceId,
      idempotencyKey: input.idempotencyKey,
      requestDigest: canonicalHash(projectId === null ? input : { ...input, projectId }),
    });
    return { token, secret, requestId: ctx.requestId };
  }
  async function list(
    ctx: ActorContext,
    input: { cursor?: string | null; limit: number },
    projectId: string | null,
  ): Promise<ListAgentTokensResult> {
    const view = viewKey({
      list: projectId === null ? 'personal_keys' : 'agent_tokens',
      projectId: projectId ?? '',
      userId: ctx.userId,
    });
    const offset = decodeCursor(input.cursor, view)?.o ?? 0;
    const rows = await store.listTokens({
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      projectId,
      offset,
      limit: input.limit + 1,
    });
    const items = rows.slice(0, input.limit);
    return {
      projectId,
      items,
      nextCursor:
        rows.length > items.length ? encodeCursor({ view, o: offset + items.length }) : null,
      requestId: ctx.requestId,
    };
  }
  async function revoke(
    ctx: ActorContext,
    input: { tokenId: string; idempotencyKey: string },
    projectId: string | null,
  ): Promise<RevokeAgentTokenResult> {
    const revokedAt = await store.revokeToken({
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      projectId,
      tokenId: input.tokenId,
      idempotencyKey: input.idempotencyKey,
      revokedAt: new Date(now()).toISOString(),
    });
    if (!revokedAt) throw new AppError('NOT_FOUND', 'Token not found');
    return { projectId, tokenId: input.tokenId, revokedAt, requestId: ctx.requestId };
  }
  return {
    async createToken(ctx: ActorContext, raw: CreateInput, actsAs?: ActsAs): Promise<TokenCreated> {
      const result = CreateAgentTokenInputSchema.safeParse(raw);
      if (!result.success) throw new AppError('VALIDATION', 'Invalid token input');
      const { projectId, ...input } = result.data;
      await authorize(ctx, projectId);
      return issue(
        ctx,
        raw,
        input,
        projectId,
        actsAs?.projectId === projectId ? actsAs : undefined,
      );
    },
    async listTokens(ctx: ActorContext, raw: ListTokensInput): Promise<ListAgentTokensResult> {
      const result = ListAgentTokensInputSchema.safeParse(raw);
      if (!result.success) throw new AppError('VALIDATION', 'Invalid token list input');
      await authorize(ctx, result.data.projectId);
      return list(ctx, result.data, result.data.projectId);
    },
    async revokeToken(
      ctx: ActorContext,
      raw: RevokeAgentTokenInput,
    ): Promise<RevokeAgentTokenResult> {
      const result = RevokeAgentTokenInputSchema.safeParse(raw);
      if (!result.success) throw new AppError('VALIDATION', 'Invalid revocation input');
      await authorize(ctx, result.data.projectId);
      return revoke(ctx, result.data, result.data.projectId);
    },
    async createPersonalKey(
      ctx: ActorContext,
      raw: CreateKeyInput,
      actsAs?: ActsAs,
    ): Promise<TokenCreated> {
      const result = CreatePersonalKeyInputSchema.safeParse(raw);
      if (!result.success) throw new AppError('VALIDATION', 'Invalid key input');
      requireUser(ctx);
      return issue(ctx, raw, result.data, null, actsAs);
    },
    async listPersonalKeys(ctx: ActorContext, raw: ListKeysInput): Promise<ListAgentTokensResult> {
      const result = ListPersonalKeysInputSchema.safeParse(raw);
      if (!result.success) throw new AppError('VALIDATION', 'Invalid key list input');
      requireUser(ctx);
      return list(ctx, result.data, null);
    },
    async revokePersonalKey(
      ctx: ActorContext,
      raw: RevokePersonalKeyInput,
    ): Promise<RevokeAgentTokenResult> {
      const result = RevokePersonalKeyInputSchema.safeParse(raw);
      if (!result.success) throw new AppError('VALIDATION', 'Invalid revocation input');
      requireUser(ctx);
      return revoke(ctx, result.data, null);
    },
  };
}
