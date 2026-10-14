import type { Pool } from 'pg';
import type { ActorContext, Scope } from '../contracts';
import { createDatabase } from './db/client';
import { DbIdentityStore } from './db/identity-store';
import type { Db } from './db/tx';
import type { HttpIdentityStore } from './http/identity-store';
import {
  configureHttpIdentityStore,
  createToken,
  getBrowserActor,
  getTokenActor,
  revokeToken,
} from './http/runtime';
export type App = { db: Db; identity: HttpIdentityStore; pool: Pool };
const state = globalThis as typeof globalThis & { promiseApp?: App };
export function getApp(): App {
  if (!state.promiseApp) {
    const { db, pool } = createDatabase();
    const identity = new DbIdentityStore(db);
    configureHttpIdentityStore(identity);
    state.promiseApp = { db, identity, pool };
  }
  return state.promiseApp;
}
// Routes and adapters resolve actors here so the database identity store is installed before runtime.ts reads it.
export function browserActor(request: Request): Promise<ActorContext> {
  getApp();
  return getBrowserActor(request);
}
export function tokenActor(request: Request, scope: Scope): Promise<ActorContext> {
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
