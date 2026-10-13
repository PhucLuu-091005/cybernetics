import { createHash } from 'node:crypto';
import { IdSchema, type ActorContext, type Scope } from '../../contracts';
import type { AuthEnvironment } from '../env';
import { browserScopes, type HttpIdentityStore } from './identity-store';
import { readLocalSession } from './local-session';
import { assertRequestOrigin, assertTokenTransport } from './origin';
import { HttpError, requestId } from './errors';
import { MemoryRateLimiter, type RateLimiter } from './rate-limit';
export type IdentityOptions = { store: HttpIdentityStore; env: AuthEnvironment; now?: () => number; limiter?: RateLimiter; clerkSubject?: (request: Request) => Promise<string | null> };
export function requestedProject(request: Request): string | null {
  const match = new URL(request.url).pathname.match(/\/projects\/([^/]+)/);
  if (!match) return null;
  const result = IdSchema.safeParse(match[1]);
  if (!result.success) throw new HttpError('NOT_FOUND', 'Project not found', 404);
  return result.data;
}
async function verifiedClerkSubject(request: Request, env: AuthEnvironment): Promise<string | null> {
  const { clerkClient } = await import('@clerk/nextjs/server');
  const state = await (await clerkClient()).authenticateRequest(request, { authorizedParties: [env.appOrigin] });
  return state.toAuth()?.userId ?? null;
}
export function createIdentityServices(options: IdentityOptions) {
  const { store, env } = options, now = options.now ?? Date.now, limiter = options.limiter ?? new MemoryRateLimiter();
  return {
    async getBrowserActor(request: Request): Promise<ActorContext> {
      assertRequestOrigin(request, env);
      let identity: { userId: string; workspaceId: string } | null;
      if (env.mode === 'local') {
        const session = readLocalSession(request, env, now());
        identity = await store.resolveUser(`local:${session.userId}`);
        if (!identity || identity.userId !== session.userId || identity.workspaceId !== session.workspaceId) throw new HttpError('UNAUTHENTICATED', 'Unknown session', 401);
      } else {
        const subject = await (options.clerkSubject ?? (request => verifiedClerkSubject(request, env)))(request);
        if (!subject) throw new HttpError('UNAUTHENTICATED', 'Session required', 401);
        identity = await store.resolveUser(subject);
        if (!identity) throw new HttpError('NOT_FOUND', 'Workspace not found', 404);
      }
      if (!await store.resolveMembership(identity.userId, identity.workspaceId)) throw new HttpError('NOT_FOUND', 'Workspace not found', 404);
      const projectId = requestedProject(request);
      if (projectId) {
        const project = await store.resolveProject(identity.userId, projectId);
        if (!project || project.workspaceId !== identity.workspaceId) throw new HttpError('NOT_FOUND', 'Project not found', 404);
      }
      const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
      limiter.consume(`user:${identity.userId}:${write ? 'write' : 'read'}`, write ? 20 : 60, now());
      return { kind: 'user', ...identity, projectId, scopes: [...browserScopes], requestId: requestId() };
    },
    async getTokenActor(request: Request, scope: Scope): Promise<ActorContext> {
      if (env.mode === 'local' && process.env.NODE_ENV === 'production') throw new HttpError('UNAUTHENTICATED', 'Local authentication unavailable', 401);
      assertTokenTransport(request, env);
      const authorization = request.headers.get('authorization');
      if (!authorization || !/^Bearer inv_[A-Za-z0-9_-]{43}$/.test(authorization)) throw new HttpError('UNAUTHENTICATED', 'Bearer token required', 401);
      const hash = createHash('sha256').update(authorization.slice(7)).digest('hex');
      const token = await store.getTokenByHash(hash);
      if (!token || token.revokedAt || Date.parse(token.expiresAt) <= now() || !Number.isFinite(Date.parse(token.expiresAt))) throw new HttpError('UNAUTHENTICATED', 'Invalid or expired token', 401);
      if (!await store.resolveMembership(token.userId, token.workspaceId)) throw new HttpError('NOT_FOUND', 'Project not found', 404);
      const project = await store.resolveProject(token.userId, token.projectId);
      const requested = requestedProject(request);
      if (!project || project.workspaceId !== token.workspaceId || (requested && requested !== token.projectId)) throw new HttpError('NOT_FOUND', 'Project not found', 404);
      limiter.consume(`token:${token.id}`, 60, now());
      if (!token.scopes.includes(scope)) throw new HttpError('FORBIDDEN', 'Token scope required', 403);
      return { kind: 'agent', userId: token.userId, tokenId: token.id, workspaceId: token.workspaceId, projectId: token.projectId, scopes: [...token.scopes], requestId: requestId() };
    },
  };
}
