import { createDatabase } from './db/client';
import { DbIdentityStore } from './db/identity-store';
import type { Db } from './db/tx';
import type { HttpIdentityStore } from './http/identity-store';
import { configureHttpIdentityStore } from './http/runtime';
export type App = { db: Db; identity: HttpIdentityStore };
const state = globalThis as typeof globalThis & { promiseApp?: App };
/** Composition root: one pool per process, no migrations or connections at import time. */
export function getApp(): App {
  if (!state.promiseApp) {
    const { db } = createDatabase();
    const identity = new DbIdentityStore(db);
    configureHttpIdentityStore(identity);
    state.promiseApp = { db, identity };
  }
  return state.promiseApp;
}
