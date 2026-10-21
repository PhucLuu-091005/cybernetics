import { createHash } from 'node:crypto';
import { IdSchema, type ActorContext, type Scope } from '../../contracts';
import type { AuthEnvironment } from '../env';
import { AppError, newRequestId } from '../errors';
import { browserScopes, type HttpIdentityStore } from './identity-store';
import { assertTokenTransport } from './origin';
import { MemoryRateLimiter, type RateLimiter } from './rate-limit';
import { readSession } from './session';
export type IdentityOptions = {
  store: HttpIdentityStore;
  env: AuthEnvironment;
  now?: () => number;
  limiter?: RateLimiter;
};
export type BrowserSession = { userId: string; defaultWorkspaceId: string };
export function projectInPath(pathname: string): string | null {
  const match = pathname.match(/\/projects\/([^/]+)/);
  if (!match) return null;
  const result = IdSchema.safeParse(match[1]);
  if (!result.success) throw new AppError('NOT_FOUND', 'Project not found');
  return result.data;
}
export function requestedProject(request: Request): string | null {
  return projectInPath(new URL(request.url).pathname);
}
export function createIdentityServices(options: IdentityOptions) {
  const { store, env } = options,
    now = options.now ?? Date.now,
    limiter = options.limiter ?? new MemoryRateLimiter();
  /** Verifies the signed session and charges the per-user rate limit; a page render calls it once for the layout and the page together. */
  async function resolveBrowserSession(request: Request): Promise<BrowserSession> {
    const session = readSession(request, env, now());
    const user = await store.resolveSessionUser(session.userId);
    if (!user) throw new AppError('UNAUTHENTICATED', 'Unknown session');
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    limiter.consume(`user:${user.userId}:${write ? 'write' : 'read'}`, write ? 120 : 300, now());
    return user;
  }
  /** Current membership decides access on every call, so a cached session never carries project access. */
  async function resolveBrowserProject(
    session: BrowserSession,
    projectId: string | null,
  ): Promise<ActorContext> {
    let workspaceId = session.defaultWorkspaceId;
    if (projectId) {
      // resolveProject checks the workspace or the project membership, so an invited member opens only this project.
      const project = await store.resolveProject(session.userId, projectId);
      if (!project) throw new AppError('NOT_FOUND', 'Project not found');
      workspaceId = project.workspaceId;
    } else if (!(await store.resolveMembership(session.userId, workspaceId)))
      throw new AppError('NOT_FOUND', 'Workspace not found');
    return {
      kind: 'user',
      userId: session.userId,
      workspaceId,
      projectId,
      scopes: [...browserScopes],
      requestId: newRequestId(),
    };
  }
  return {
    resolveBrowserSession,
    resolveBrowserProject,
    async getBrowserActor(request: Request): Promise<ActorContext> {
      const session = await resolveBrowserSession(request);
      return resolveBrowserProject(session, requestedProject(request));
    },
    /** A null scope verifies the token only; the caller must then check scope per operation (the MCP route does so per tool). */
    async getTokenActor(request: Request, scope: Scope | null): Promise<ActorContext> {
      if (env.mode === 'local' && process.env.NODE_ENV === 'production')
        throw new AppError('UNAUTHENTICATED', 'Local authentication unavailable');
      assertTokenTransport(request, env);
      const authorization = request.headers.get('authorization');
      if (!authorization || !/^Bearer inv_[A-Za-z0-9_-]{43}$/.test(authorization))
        throw new AppError('UNAUTHENTICATED', 'Bearer token required');
      const hash = createHash('sha256').update(authorization.slice(7)).digest('hex');
      const token = await store.getTokenByHash(hash);
      if (
        !token ||
        token.revokedAt ||
        Date.parse(token.expiresAt) <= now() ||
        !Number.isFinite(Date.parse(token.expiresAt))
      )
        throw new AppError('UNAUTHENTICATED', 'Invalid or expired token');
      const project = await store.resolveProject(token.userId, token.projectId);
      const requested = requestedProject(request);
      if (
        !project ||
        project.workspaceId !== token.workspaceId ||
        (requested && requested !== token.projectId)
      )
        throw new AppError('NOT_FOUND', 'Project not found');
      limiter.consume(`token:${token.id}`, 60, now());
      const at = now();
      if (!token.lastUsedAt || at - Date.parse(token.lastUsedAt) >= 60_000)
        await store.touchToken(token.id, new Date(at).toISOString());
      if (scope !== null && !token.scopes.includes(scope))
        throw new AppError('FORBIDDEN', 'Token scope required');
      return {
        kind: 'agent',
        userId: token.userId,
        tokenId: token.id,
        workspaceId: token.workspaceId,
        projectId: token.projectId,
        scopes: [...token.scopes],
        requestId: newRequestId(),
      };
    },
  };
}
