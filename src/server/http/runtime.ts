import type {
  ActorContext,
  CreateAgentTokenInput,
  CreatePersonalKeyInput,
  RevokePersonalKeyInput,
  ListAgentTokensResult,
  RevokeAgentTokenInput,
  RevokeAgentTokenResult,
  Scope,
  TokenCreated,
} from '../../contracts';
import { readAuthEnvironment } from '../env';
import {
  createTokenService,
  type ActsAs,
  type CreatorOf,
  type ListKeysInput,
  type ListTokensInput,
} from '../domain/tokens/service';
import { createIdentityServices, type BrowserSession, type LimitBucket } from './actors';
import type { HttpIdentityStore } from './identity-store';
import { MemoryRateLimiter } from './rate-limit';
const state = globalThis as typeof globalThis & {
  promiseIdentityStore?: HttpIdentityStore;
  promiseRateLimiter?: MemoryRateLimiter;
};
/** Application composition installs the real persistence adapter; absence fails closed. */
export function configureHttpIdentityStore(store: HttpIdentityStore): void {
  state.promiseIdentityStore = store;
}
export function getHttpIdentityStore(): HttpIdentityStore {
  if (!state.promiseIdentityStore) throw new Error('Identity persistence is unavailable');
  return state.promiseIdentityStore;
}
export function getRateLimiter(): MemoryRateLimiter {
  state.promiseRateLimiter ??= new MemoryRateLimiter();
  return state.promiseRateLimiter;
}
function identities() {
  return createIdentityServices({
    store: getHttpIdentityStore(),
    env: readAuthEnvironment(),
    limiter: getRateLimiter(),
  });
}
export async function getBrowserActor(
  request: Request,
  bucket?: LimitBucket,
): Promise<ActorContext> {
  return identities().getBrowserActor(request, bucket);
}
export async function getBrowserSession(request: Request): Promise<BrowserSession> {
  return identities().resolveBrowserSession(request);
}
export async function getBrowserProjectActor(
  session: BrowserSession,
  projectId: string | null,
): Promise<ActorContext> {
  return identities().resolveBrowserProject(session, projectId);
}
export async function getTokenActor(request: Request, scope: Scope | null): Promise<ActorContext> {
  return identities().getTokenActor(request, scope);
}
// Loaded on use: the app module imports this one, and the creator's rights live in the tracker.
const creatorOf: CreatorOf = async (ctx, projectId, actsAs) => {
  const [{ getApp }, { personalCreator, tokenCreator }] = await Promise.all([
    import('../app'),
    import('../domain/account'),
  ]);
  const db = getApp().db;
  if (actsAs) return tokenCreator(db, ctx, actsAs.projectId, actsAs.memberId);
  return projectId === null ? personalCreator(db, ctx) : tokenCreator(db, ctx, projectId);
};
const tokenService = () => createTokenService(getHttpIdentityStore(), creatorOf);

export async function createToken(
  ctx: ActorContext,
  input: Omit<CreateAgentTokenInput, 'scopes'> & { scopes?: Scope[] },
  actsAs?: ActsAs,
): Promise<TokenCreated> {
  return tokenService().createToken(ctx, input, actsAs);
}
export async function revokeToken(
  ctx: ActorContext,
  input: RevokeAgentTokenInput,
): Promise<RevokeAgentTokenResult> {
  return tokenService().revokeToken(ctx, input);
}
export async function listTokens(
  ctx: ActorContext,
  input: ListTokensInput,
): Promise<ListAgentTokensResult> {
  return tokenService().listTokens(ctx, input);
}
export async function createPersonalKey(
  ctx: ActorContext,
  input: Omit<CreatePersonalKeyInput, 'scopes'> & { scopes?: Scope[] },
  actsAs?: ActsAs,
): Promise<TokenCreated> {
  return tokenService().createPersonalKey(ctx, input, actsAs);
}
export async function revokePersonalKey(
  ctx: ActorContext,
  input: RevokePersonalKeyInput,
): Promise<RevokeAgentTokenResult> {
  return tokenService().revokePersonalKey(ctx, input);
}
export async function listPersonalKeys(
  ctx: ActorContext,
  input: ListKeysInput,
): Promise<ListAgentTokensResult> {
  return tokenService().listPersonalKeys(ctx, input);
}
