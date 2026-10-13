import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { CreateAgentTokenInputSchema, RevokeAgentTokenInputSchema, type ActorContext, type CreateAgentTokenInput, type RevokeAgentTokenInput, type RevokeAgentTokenResult, type TokenCreated } from '../../../contracts';
import { canonicalHash } from '../../../lib/canonical-json';
import type { HttpIdentityStore } from '../../http/identity-store';
import { HttpError } from '../../http/errors';
type CreateInput = Omit<CreateAgentTokenInput, 'scopes'> & { scopes?: CreateAgentTokenInput['scopes'] };
export function createTokenService(store: HttpIdentityStore, now: () => number = Date.now) {
  async function authorize(ctx: ActorContext, projectId: string): Promise<void> {
    if (ctx.kind !== 'user') throw new HttpError('FORBIDDEN', 'Only browser users can manage tokens', 403);
    const project = await store.resolveProject(ctx.userId, projectId);
    if ((ctx.projectId && ctx.projectId !== projectId) || !project || project.workspaceId !== ctx.workspaceId || !await store.resolveMembership(ctx.userId, ctx.workspaceId)) throw new HttpError('NOT_FOUND', 'Project not found', 404);
  }
  return {
    async createToken(ctx: ActorContext, raw: CreateInput): Promise<TokenCreated> {
      const result = CreateAgentTokenInputSchema.safeParse(raw);
      if (!result.success) throw new HttpError('VALIDATION', 'Invalid token input', 400);
      const input = result.data; await authorize(ctx, input.projectId);
      const createdAt = new Date(now()).toISOString(), expiresAt = input.expiresAt ?? new Date(now() + 30 * 86_400_000).toISOString();
      if (Date.parse(expiresAt) <= now()) throw new HttpError('VALIDATION', 'Token expiry must be in the future', 400);
      const secret = `inv_${randomBytes(32).toString('base64url')}`;
      const token = { id: randomUUID(), userId: ctx.userId, projectId: input.projectId, prefix: secret.slice(0, 8), scopes: [...new Set(input.scopes)], createdAt, expiresAt, revokedAt: null };
      await store.insertToken({ ...token, hash: createHash('sha256').update(secret).digest('hex'), workspaceId: ctx.workspaceId, label: input.label, idempotencyKey: input.idempotencyKey, requestDigest: canonicalHash(input) });
      return { token, secret, requestId: ctx.requestId };
    },
    async revokeToken(ctx: ActorContext, raw: RevokeAgentTokenInput): Promise<RevokeAgentTokenResult> {
      const result = RevokeAgentTokenInputSchema.safeParse(raw);
      if (!result.success) throw new HttpError('VALIDATION', 'Invalid revocation input', 400);
      await authorize(ctx, result.data.projectId);
      const revokedAt = await store.revokeToken({ userId: ctx.userId, workspaceId: ctx.workspaceId, projectId: result.data.projectId, tokenId: result.data.tokenId, idempotencyKey: result.data.idempotencyKey, revokedAt: new Date(now()).toISOString() });
      if (!revokedAt) throw new HttpError('NOT_FOUND', 'Token not found', 404);
      return { projectId: result.data.projectId, tokenId: result.data.tokenId, revokedAt, requestId: ctx.requestId };
    },
  };
}
