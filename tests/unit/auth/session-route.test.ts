import { afterEach, describe, expect, it, vi } from 'vitest';
import { DELETE } from '../../../src/app/api/auth/session/route';

const configure = () => {
  vi.stubEnv('AUTH_MODE', 'google'); vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://pg.example'); vi.stubEnv('SESSION_SECRET', 's'.repeat(32));
  vi.stubEnv('GOOGLE_CLIENT_ID', 'id'); vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
};
const signOut = (headers: Record<string, string>) => DELETE(new Request('https://pg.example/api/auth/session', { method: 'DELETE', headers }));
afterEach(() => { vi.unstubAllEnvs(); });

describe('DELETE /api/auth/session', () => {
  it('clears the session for a same-origin request', async () => {
    configure();
    const response = await signOut({ origin: 'https://pg.example' });
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toBe('pg_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  });
  it('refuses a foreign Origin and a missing Origin', async () => {
    configure();
    for (const headers of [{ origin: 'https://evil.example' }, {}] as Record<string, string>[]) {
      const response = await signOut(headers);
      expect(response.status).toBe(403);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });
});
