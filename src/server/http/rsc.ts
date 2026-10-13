import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ActorContext } from '../../contracts';
import { browserActor } from '../app';
import { readAuthEnvironment } from '../env';
import { AppError } from '../errors';

export const RATE_LIMITED_DIGEST = 'RATE_LIMITED';

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
    if (!(error instanceof AppError)) throw error;
    if (error.code === 'UNAUTHENTICATED') return null;
    // A project outside the user's workspaces must look the same as one that does not exist.
    if (error.code === 'NOT_FOUND') notFound();
    // The digest survives production error masking, so the error page can name the cause.
    if (error.code === 'RATE_LIMITED') throw Object.assign(new Error('Too many requests'), { digest: RATE_LIMITED_DIGEST });
    throw error;
  }
}

export async function requireActor(path: string): Promise<ActorContext> {
  const actor = await optionalActor(path);
  if (!actor) redirect('/signin');
  return actor;
}

/** Domain reads answer NOT_FOUND for foreign or missing rows; a page shows the same 404 for both. */
export async function notFoundOn<T>(work: Promise<T>): Promise<T> {
  try { return await work; }
  catch (error) { if (error instanceof AppError && error.code === 'NOT_FOUND') notFound(); throw error; }
}
