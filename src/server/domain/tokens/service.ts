import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  CreateAgentTokenInputSchema,
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
/** The creator of a token as their member rows say today. */
export type CreatorOf = (ctx: ActorContext, projectId: string) => Promise<Creator>;

export function createTokenService(
  store: HttpIdentityStore,
  creatorOf: CreatorOf,
  now: () => number = Date.now,
) {
  async function authorize(ctx: ActorContext, projectId: string): Promise<void> {
    if (ctx.kind !== 'user')
      throw new AppError('FORBIDDEN', 'Only browser users can manage tokens');
    const project = await store.resolveProject(ctx.userId, projectId);
    if (
      (ctx.projectId && ctx.projectId !== projectId) ||
      !project ||
      project.workspaceId !== ctx.workspaceId
    )
      throw new AppError('NOT_FOUND', 'Project not found');
  }
  return {
    async createToken(ctx: ActorContext, raw: CreateInput): Promise<TokenCreated> {
      const result = CreateAgentTokenInputSchema.safeParse(raw);
      if (!result.success) throw new AppError('VALIDATION', 'Invalid token input');
      const input = result.data;
      await authorize(ctx, input.projectId);
      // The same rule as the page: a token never asks for a right its creator lacks. Each call checks again.
      const creator = await creatorOf(ctx, input.projectId);
      const blockOf = (scope: string) =>
        scopeBlock(
          SCOPE_INFO.find((info) => info.scope === scope)!,
          creator,
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
      const token = {
        id: randomUUID(),
        userId: ctx.userId,
        projectId: input.projectId,
        prefix: secret.slice(0, 8),
        label: input.label,
        scopes: [...new Set(input.scopes)],
        createdAt,
        expiresAt,
        revokedAt: null,
        lastUsedAt: null,
      };
      await store.insertToken({
        ...token,
        hash: createHash('sha256').update(secret).digest('hex'),
        workspaceId: ctx.workspaceId,
        idempotencyKey: input.idempotencyKey,
        requestDigest: canonicalHash(input),
      });
      return { token, secret, requestId: ctx.requestId };
    },
    async listTokens(ctx: ActorContext, raw: ListTokensInput): Promise<ListAgentTokensResult> {
      const result = ListAgentTokensInputSchema.safeParse(raw);
      if (!result.success) throw new AppError('VALIDATION', 'Invalid token list input');
      const input = result.data;
      await authorize(ctx, input.projectId);
      const view = viewKey({
        list: 'agent_tokens',
        projectId: input.projectId,
        userId: ctx.userId,
      });
      const offset = decodeCursor(input.cursor, view)?.o ?? 0;
      const rows = await store.listTokens({
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        offset,
        limit: input.limit + 1,
      });
      const items = rows.slice(0, input.limit);
      return {
        projectId: input.projectId,
        items,
        nextCursor:
          rows.length > items.length ? encodeCursor({ view, o: offset + items.length }) : null,
        requestId: ctx.requestId,
      };
    },
    async revokeToken(
      ctx: ActorContext,
      raw: RevokeAgentTokenInput,
    ): Promise<RevokeAgentTokenResult> {
      const result = RevokeAgentTokenInputSchema.safeParse(raw);
      if (!result.success) throw new AppError('VALIDATION', 'Invalid revocation input');
      await authorize(ctx, result.data.projectId);
      const revokedAt = await store.revokeToken({
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        projectId: result.data.projectId,
        tokenId: result.data.tokenId,
        idempotencyKey: result.data.idempotencyKey,
        revokedAt: new Date(now()).toISOString(),
      });
      if (!revokedAt) throw new AppError('NOT_FOUND', 'Token not found');
      return {
        projectId: result.data.projectId,
        tokenId: result.data.tokenId,
        revokedAt,
        requestId: ctx.requestId,
      };
    },
  };
}
