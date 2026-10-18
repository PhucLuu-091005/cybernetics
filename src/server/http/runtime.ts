import type {
  ActorContext,
  CreateAgentTokenInput,
  ListAgentTokensResult,
  RevokeAgentTokenInput,
  RevokeAgentTokenResult,
  Scope,
  TokenCreated,
} from '../../contracts';
import { readAuthEnvironment } from '../env';
import { createTokenService, type CreatorOf, type ListTokensInput } from '../domain/tokens/service';
import { createIdentityServices, type BrowserSession } from './actors';
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
function identities() {
  const store = getHttpIdentityStore();
  state.promiseRateLimiter ??= new MemoryRateLimiter();
  return createIdentityServices({
    store,
    env: readAuthEnvironment(),
    limiter: state.promiseRateLimiter,
  });
}
export async function getBrowserActor(request: Request): Promise<ActorContext> {
  return identities().getBrowserActor(request);
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
const creatorOf: CreatorOf = async (ctx, projectId) => {
  const [{ getApp }, { tokenCreator }] = await Promise.all([
    import('../app'),
    import('../domain/account'),
  ]);
  return tokenCreator(getApp().db, ctx, projectId);
};
const tokenService = () => createTokenService(getHttpIdentityStore(), creatorOf);

export async function createToken(
  ctx: ActorContext,
  input: Omit<CreateAgentTokenInput, 'scopes'> & { scopes?: Scope[] },
): Promise<TokenCreated> {
  return tokenService().createToken(ctx, input);
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
