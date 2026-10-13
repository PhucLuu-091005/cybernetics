import { describe, expect, it } from 'vitest';
import { readAuthEnvironment } from '../../../src/server/env';
const local = { NODE_ENV: 'test', AUTH_MODE: 'local', NEXT_PUBLIC_APP_URL: 'http://localhost:3000', LOCAL_SESSION_SECRET: 'a'.repeat(64) };
describe('auth configuration fails closed', () => {
  it('accepts deliberate loopback development configuration', () => {
    expect(readAuthEnvironment(local).mode).toBe('local');
  });
  it('rejects local mode in production', () => {
    expect(() => readAuthEnvironment({ ...local, NODE_ENV: 'production' })).toThrow();
  });
  it('rejects local mode on a public host and short secrets', () => {
    expect(() => readAuthEnvironment({ ...local, NEXT_PUBLIC_APP_URL: 'https://example.com' })).toThrow();
    expect(() => readAuthEnvironment({ ...local, LOCAL_SESSION_SECRET: 'short' })).toThrow();
  });
  it('never falls back to local when Clerk is unconfigured', () => {
    expect(() => readAuthEnvironment({ NODE_ENV: 'production', AUTH_MODE: 'clerk', NEXT_PUBLIC_APP_URL: 'https://example.com' })).toThrow();
    expect(() => readAuthEnvironment({})).toThrow();
  });
  it('requires https for production Clerk', () => {
    expect(() => readAuthEnvironment({ AUTH_MODE: 'clerk', NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'http://example.com', CLERK_SECRET_KEY: 'sk_test_x', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_x' })).toThrow();
  });
});
