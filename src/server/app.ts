import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ActorContext, Scope } from '../contracts';
import { createDatabase } from './db/client';
import { DbIdentityStore, type UserCreatedHook } from './db/identity-store';
import type { Db } from './db/tx';
import { browserScopes, type HttpIdentityStore } from './http/identity-store';
import type { BrowserSession } from './http/actors';
import {
  configureHttpIdentityStore,
  createToken,
  getBrowserActor,
  getBrowserProjectActor,
  getBrowserSession,
  getTokenActor,
  listTokens,
  revokeToken,
} from './http/runtime';
export type App = { db: Db; identity: HttpIdentityStore; pool: Pool };
const state = globalThis as typeof globalThis & { promiseApp?: App };
/** Loaded on first sign-in only, so routes do not carry the fixture JSON. */
export const seedOnUserCreated: UserCreatedHook = async (tx, { userId, workspaceId }) => {
  const { seedSandbox } = await import('./domain/seed');
  await seedSandbox(tx, {
    kind: 'user',
    userId,
    workspaceId,
    projectId: null,
    scopes: [...browserScopes],
    requestId: randomUUID(),
  });
};
const identityStore = (db: Db) => new DbIdentityStore(db, { onUserCreated: seedOnUserCreated });
export function getApp(): App {
  if (!state.promiseApp) {
    const { db, pool } = createDatabase();
    const identity = identityStore(db);
    configureHttpIdentityStore(identity);
    state.promiseApp = { db, identity, pool };
  }
  return state.promiseApp;
}
/** Points routes at another database (integration tests); the pool defaults to the one behind `db`. */
export function configureApp(app: Partial<App> & { db: Db }): App {
  const identity = app.identity ?? identityStore(app.db);
  configureHttpIdentityStore(identity);
  state.promiseApp = {
    db: app.db,
    identity,
    pool: app.pool ?? (app.db as unknown as { $client: Pool }).$client,
  };
  return state.promiseApp;
}
export function resetApp(): void {
  delete state.promiseApp;
}
// Routes and adapters resolve actors here so the database identity store is installed before runtime.ts reads it.
export function browserActor(request: Request): Promise<ActorContext> {
  getApp();
  return getBrowserActor(request);
}
export function browserSession(request: Request): Promise<BrowserSession> {
  getApp();
  return getBrowserSession(request);
}
export function browserProjectActor(
  session: BrowserSession,
  projectId: string | null,
): Promise<ActorContext> {
  getApp();
  return getBrowserProjectActor(session, projectId);
}
export function tokenActor(request: Request, scope: Scope | null): Promise<ActorContext> {
  getApp();
  return getTokenActor(request, scope);
}
export function createAgentToken(
  ...args: Parameters<typeof createToken>
): ReturnType<typeof createToken> {
  getApp();
  return createToken(...args);
}
export function revokeAgentToken(
  ...args: Parameters<typeof revokeToken>
): ReturnType<typeof revokeToken> {
  getApp();
  return revokeToken(...args);
}
export function listAgentTokens(
  ...args: Parameters<typeof listTokens>
): ReturnType<typeof listTokens> {
  getApp();
  return listTokens(...args);
}
