/** A layout cannot see the page path, so the proxy hands every request the path that it asked for. */
export const RETURN_PATH_HEADER = 'x-pg-return-path';

const BASE = 'https://return-path.invalid';
const NOT_A_PAGE = /^\/(?:api|mcp|signin|_next)(?:\/|$)/;

/**
 * The page to open after sign-in, or null for the home page. Only a path of this app passes: a
 * value that could name another host would turn sign-in into an open redirect.
 */
export function returnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\s]/.test(raw)) return null;
  if ([...raw].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE || url.pathname === '/' || NOT_A_PAGE.test(url.pathname)) return null;
  return url.pathname + url.search;
}

export const signinPath = (next: string | null) =>
  next ? `/signin?next=${encodeURIComponent(next)}` : '/signin';
