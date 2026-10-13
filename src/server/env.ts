export type AuthEnvironment = { mode: 'local' | 'clerk'; appOrigin: string; localSessionSecret?: string };
export function isLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
}
export function readAuthEnvironment(values: Record<string, string | undefined> = process.env): AuthEnvironment {
  if (values.AUTH_MODE !== 'local' && values.AUTH_MODE !== 'clerk') throw new Error('AUTH_MODE must be explicitly configured');
  const url = new URL(values.NEXT_PUBLIC_APP_URL ?? '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid application origin');
  if (values.AUTH_MODE === 'local') {
    if (values.NODE_ENV === 'production' || !isLoopback(url.hostname)) throw new Error('Local authentication is restricted to loopback development');
    if (Buffer.byteLength(values.LOCAL_SESSION_SECRET ?? '') < 32) throw new Error('LOCAL_SESSION_SECRET must contain at least 32 bytes');
    return { mode: 'local', appOrigin: url.origin, localSessionSecret: values.LOCAL_SESSION_SECRET };
  }
  if (!values.CLERK_SECRET_KEY || !values.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) throw new Error('Clerk authentication is not configured');
  if (values.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Production requires HTTPS');
  return { mode: 'clerk', appOrigin: url.origin };
}
