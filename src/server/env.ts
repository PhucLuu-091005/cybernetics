export type AuthEnvironment = {
  mode: 'google' | 'local' | 'demo';
  appOrigin: string;
  sessionSecret: string;
  google: { clientId: string; clientSecret: string } | null;
};
export function isLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
}
export function readAuthEnvironment(
  values: Record<string, string | undefined> = process.env,
): AuthEnvironment {
  const mode = values.AUTH_MODE;
  if (mode !== 'google' && mode !== 'local' && mode !== 'demo')
    throw new Error('AUTH_MODE must be google, local or demo');
  const url = new URL(values.NEXT_PUBLIC_APP_URL ?? '');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid application origin');
  const sessionSecret = values.SESSION_SECRET ?? '';
  if (
    values.AUTH_MODE === 'local' &&
    (values.NODE_ENV === 'production' || !isLoopback(url.hostname))
  )
    throw new Error('Local authentication is restricted to loopback development');
  if (Buffer.byteLength(sessionSecret) < 32)
    throw new Error('SESSION_SECRET must contain at least 32 bytes');
  if (mode === 'local') return { mode, appOrigin: url.origin, sessionSecret, google: null };
  if (values.NODE_ENV === 'production' && url.protocol !== 'https:')
    throw new Error('Production requires HTTPS');
  if (mode === 'demo') return { mode, appOrigin: url.origin, sessionSecret, google: null };
  if (!values.GOOGLE_CLIENT_ID || !values.GOOGLE_CLIENT_SECRET)
    throw new Error('Google sign-in is not configured');
  return {
    mode: 'google',
    appOrigin: url.origin,
    sessionSecret,
    google: { clientId: values.GOOGLE_CLIENT_ID, clientSecret: values.GOOGLE_CLIENT_SECRET },
  };
}
