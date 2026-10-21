import { describe, expect, it } from 'vitest';
import { readAuthEnvironment } from '../../../src/server/env';
const local = {
  NODE_ENV: 'test',
  AUTH_MODE: 'local',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  SESSION_SECRET: 'a'.repeat(64),
};
const google = {
  NODE_ENV: 'production',
  AUTH_MODE: 'google',
  NEXT_PUBLIC_APP_URL: 'https://pg.example',
  SESSION_SECRET: 'b'.repeat(64),
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
};
describe('auth configuration fails closed', () => {
  it('accepts deliberate loopback development configuration', () => {
    expect(readAuthEnvironment(local)).toEqual({
      mode: 'local',
      appOrigin: 'http://localhost:3000',
      sessionSecret: 'a'.repeat(64),
      google: null,
    });
  });
  it('rejects local mode in production', () => {
    expect(() => readAuthEnvironment({ ...local, NODE_ENV: 'production' })).toThrow(
      /loopback development/,
    );
  });
  it('rejects local mode on a public host and short secrets', () => {
    expect(() =>
      readAuthEnvironment({ ...local, NEXT_PUBLIC_APP_URL: 'https://example.com' }),
    ).toThrow(/loopback development/);
    expect(() => readAuthEnvironment({ ...local, SESSION_SECRET: 'short' })).toThrow(
      /SESSION_SECRET/,
    );
  });
  it('accepts a complete production Google configuration', () => {
    expect(readAuthEnvironment(google)).toEqual({
      mode: 'google',
      appOrigin: 'https://pg.example',
      sessionSecret: 'b'.repeat(64),
      google: { clientId: 'id', clientSecret: 'secret' },
    });
  });
  it('requires Google client credentials and a 32-byte session secret', () => {
    expect(() => readAuthEnvironment({ ...google, GOOGLE_CLIENT_ID: '' })).toThrow(
      /Google sign-in is not configured/,
    );
    expect(() => readAuthEnvironment({ ...google, GOOGLE_CLIENT_SECRET: undefined })).toThrow(
      /Google sign-in is not configured/,
    );
    expect(() => readAuthEnvironment({ ...google, SESSION_SECRET: 'x'.repeat(31) })).toThrow(
      /SESSION_SECRET/,
    );
  });
  it('requires https for production Google sign-in', () => {
    expect(() =>
      readAuthEnvironment({ ...google, NEXT_PUBLIC_APP_URL: 'http://pg.example' }),
    ).toThrow(/HTTPS/);
  });
  it('refuses any other or missing mode', () => {
    expect(() => readAuthEnvironment({ ...google, AUTH_MODE: 'clerk' })).toThrow(
      'AUTH_MODE must be google or local',
    );
    expect(() => readAuthEnvironment({})).toThrow('AUTH_MODE must be google or local');
  });
});
