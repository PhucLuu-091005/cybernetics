import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ActorContext } from '../../contracts';
import { browserActor } from '../app';
import { readAuthEnvironment } from '../env';
import { AppError } from '../errors';

/** Server components have no Request, so this rebuilds the page GET that browserActor checks for routes. */
export async function pageRequest(path: string): Promise<Request> {
  const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);
  const host = headerList.get('host');
  if (!host) throw new AppError('UNAUTHENTICATED', 'Host header required');
  const { protocol } = new URL(readAuthEnvironment().appOrigin);
  const cookie = cookieStore.getAll().map(item => `${item.name}=${item.value}`).join('; ');
  return new Request(new URL(path, `${protocol}//${host}`), { method: 'GET', headers: { host, ...(cookie ? { cookie } : {}) } });
}

export async function optionalActor(path: string): Promise<ActorContext | null> {
  try { return await browserActor(await pageRequest(path)); }
  catch (error) {
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED') return null;
    throw error;
  }
}

export async function requireActor(path: string): Promise<ActorContext> {
  const actor = await optionalActor(path);
  if (!actor) redirect('/signin');
  return actor;
}
