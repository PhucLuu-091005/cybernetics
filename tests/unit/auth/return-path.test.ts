import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as localSignIn } from '../../../src/app/api/auth/local/route';
import { configureApp, resetApp } from '../../../src/server/app';
import type { Db } from '../../../src/server/db/tx';
import { RETURN_PATH_HEADER, returnPath, signinPath } from '../../../src/server/http/return-path';
import proxy from '../../../src/proxy';
import { memoryStore } from './test-store';

const LINK = '/projects/4f0c2a52-31a8-4b0f-9a57-0f1d3c9a2b11/changes/2';

describe('return path after sign-in', () => {
  it('keeps a page path of this app with its query', () => {
    expect(returnPath(LINK)).toBe(LINK);
    expect(returnPath(`${LINK}?op=3`)).toBe(`${LINK}?op=3`);
    expect(returnPath('/projects/a/graph/../members')).toBe('/projects/a/members');
  });

  it('refuses another origin, a scheme, a protocol-relative or a backslash path', () => {
    for (const raw of [
      'https://evil.example/projects',
      '//evil.example/projects',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      ' /projects',
      '/projects\n/x',
      '/projects\t',
      'projects/a/graph',
      '',
      `/${'a'.repeat(2001)}`,
    ])
      expect(returnPath(raw), raw).toBeNull();
    for (const raw of [
      '/.//evil.com',
      '/a/..//evil.com',
      '/%2e%2e//evil.com',
      '/a/%2e%2e//evil.com',
      '/%2E%2E//evil.com',
      '/a/%2E%2e//evil.com',
      '/%2e//evil.com',
      '/a/.%2e//evil.com',
      '/a/%2e./%2e%2e//evil.com',
      '/a/..//evil.com?x=1',
    ]) {
      expect(returnPath(raw), raw).toBeNull();
      expect(returnPath(new URL(raw, 'https://app.invalid').pathname), raw).toBeNull();
    }
    for (const raw of ['/a/../signin', '/x/%2e%2e/api/v1', '/./mcp', '/a/..', '/a/%2e%2e/_next/x'])
      expect(returnPath(raw), raw).toBeNull();
    expect(returnPath(undefined)).toBeNull();
    expect(returnPath(['/projects'])).toBeNull();
  });

  it('refuses the home page, the sign-in page and the API, which are no place to land', () => {
    for (const raw of ['/', '/signin', '/signin?next=/x', '/api/v1/projects', '/mcp', '/_next/x'])
      expect(returnPath(raw), raw).toBeNull();
    expect(returnPath('/apiary')).toBe('/apiary');
  });

  it('builds the sign-in link with the return path, or plain without one', () => {
    expect(signinPath(LINK)).toBe(`/signin?next=${encodeURIComponent(LINK)}`);
    expect(signinPath(null)).toBe('/signin');
  });

  it('gives each page request the path it asked for, without the RSC marker', () => {
    const response = proxy(new NextRequest(`http://localhost:3000${LINK}?_rsc=abc&op=3`));
    expect(response.headers.get(`x-middleware-request-${RETURN_PATH_HEADER}`)).toBe(`${LINK}?op=3`);
  });
});

describe('local sign-in lands on the return path', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetApp();
  });
  const signIn = (query: string) => {
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SESSION_SECRET', 'ef'.repeat(32));
    configureApp({ db: {} as Db, identity: memoryStore(), pool: {} as never });
    return localSignIn(
      new Request(`http://localhost:3000/api/auth/local${query}`, {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      }),
    );
  };

  it('goes to the link the person opened', async () => {
    const response = await signIn(`?next=${encodeURIComponent(LINK)}`);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(LINK);
  });

  it('goes home for a missing or foreign return path', async () => {
    for (const query of ['', '?next=%2F%2Fevil.example', '?next=https%3A%2F%2Fevil.example']) {
      const response = await signIn(query);
      expect(response.headers.get('location')).toBe('/');
    }
  });
});
