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
import { createTokenService, type ListTokensInput } from '../domain/tokens/service';
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
export async function createToken(
  ctx: ActorContext,
  input: Omit<CreateAgentTokenInput, 'scopes'> & { scopes?: Scope[] },
): Promise<TokenCreated> {
  return createTokenService(getHttpIdentityStore()).createToken(ctx, input);
}
export async function revokeToken(
  ctx: ActorContext,
  input: RevokeAgentTokenInput,
): Promise<RevokeAgentTokenResult> {
  return createTokenService(getHttpIdentityStore()).revokeToken(ctx, input);
}
export async function listTokens(
  ctx: ActorContext,
  input: ListTokensInput,
): Promise<ListAgentTokensResult> {
  return createTokenService(getHttpIdentityStore()).listTokens(ctx, input);
}
