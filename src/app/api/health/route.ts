import { APP_VERSION } from '../../../server/version';

export const runtime = 'nodejs';
/** Liveness only: no DB/provider secrets required to build or start. */
export function GET(): Response {
  return Response.json(
    { status: 'ok', version: APP_VERSION },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
