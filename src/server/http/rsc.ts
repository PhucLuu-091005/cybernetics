import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import type { ActorContext } from '../../contracts';
import { browserProjectActor, browserSession, getApp } from '../app';
import { personOnScreen, type OnScreen } from '../domain/account';
import { readAuthEnvironment } from '../env';
import { AppError } from '../errors';
import { actAsCookieName } from './act-as';
import { projectInPath } from './actors';
import { demoEntryPath } from './demo';
import { RETURN_PATH_HEADER, returnPath, signinPath } from './return-path';

const RATE_LIMITED_DIGEST = 'RATE_LIMITED';

/** Server components have no Request, so this rebuilds the GET that the browser session check reads for routes. */
async function pageRequest(path: string): Promise<Request> {
  const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);
  const host = headerList.get('host');
  if (!host) throw new AppError('UNAUTHENTICATED', 'Host header required');
  const { protocol } = new URL(readAuthEnvironment().appOrigin);
  const cookie = cookieStore
    .getAll()
    .map((item) => `${item.name}=${item.value}`)
    .join('; ');
  return new Request(new URL(path, `${protocol}//${host}`), {
    method: 'GET',
    headers: { host, ...(cookie ? { cookie } : {}) },
  });
}

// The layout and the page of one render share this, so a page view verifies the session and charges the read limit once.
const pageSession = cache(async () => browserSession(await pageRequest('/')));

export async function optionalActor(path: string): Promise<ActorContext | null> {
  try {
    return await browserProjectActor(
      await pageSession(),
      projectInPath(new URL(path, 'http://page.invalid').pathname),
    );
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === 'UNAUTHENTICATED') return null;
    // A project outside the user's workspaces must look the same as one that does not exist.
    if (error.code === 'NOT_FOUND') notFound();
    // The digest survives production error masking, so the error page can name the cause.
    if (error.code === 'RATE_LIMITED')
      throw Object.assign(new Error('Too many requests'), { digest: RATE_LIMITED_DIGEST });
    throw error;
  }
}

export async function requireActor(path: string): Promise<ActorContext> {
  const actor = await optionalActor(path);
  if (!actor) {
    const next = returnPath((await headers()).get(RETURN_PATH_HEADER) ?? path);
    redirect(readAuthEnvironment().mode === 'demo' ? demoEntryPath(next) : signinPath(next));
  }
  return actor;
}

/** The person a project page shows as "me"; pages never read the act-as cookie or the user for that. */
export async function pageOnScreen(actor: ActorContext, projectId: string): Promise<OnScreen> {
  const cookie = (await cookies()).get(actAsCookieName(projectId))?.value;
  return personOnScreen(getApp().db, actor, projectId, cookie);
}

/** Domain reads answer NOT_FOUND for foreign or missing rows; a page shows the same 404 for both. */
export async function notFoundOn<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
}

/** A stale or edited `?cursor=` is a page that does not exist, not a server error. */
export async function notFoundOnCursor<T>(work: Promise<T>, cursor: string | null): Promise<T> {
  try {
    return await notFoundOn(work);
  } catch (error) {
    if (cursor !== null && error instanceof AppError && error.code === 'VALIDATION') notFound();
    throw error;
  }
}

export const searchCursor = (value: string | string[] | undefined): string | null =>
  typeof value === 'string' && value ? value : null;
