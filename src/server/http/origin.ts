import { isLoopback, type AuthEnvironment } from '../env';
import { AppError } from '../errors';
export function assertRequestOrigin(
  request: Request,
  env: AuthEnvironment,
  mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method),
): void {
  const url = new URL(request.url);
  if (
    env.mode === 'local' &&
    (!isLoopback(url.hostname) ||
      url.origin !== env.appOrigin ||
      (request.headers.has('host') && request.headers.get('host') !== url.host))
  )
    throw new AppError('FORBIDDEN', 'Local requests require the configured loopback origin');
  if (mutation && request.headers.get('origin') !== env.appOrigin)
    throw new AppError('FORBIDDEN', 'Invalid browser Origin');
}

export function assertTokenTransport(request: Request, env: AuthEnvironment): void {
  assertRequestOrigin(request, env, false);
  const expectedHost = new URL(env.appOrigin).host;
  if ((request.headers.get('host') ?? new URL(request.url).host) !== expectedHost)
    throw new AppError('FORBIDDEN', 'Invalid request Host');
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== env.appOrigin)
    throw new AppError('FORBIDDEN', 'Invalid request Origin');
}
