import { readAuthEnvironment } from '../../../../server/env';
import { getHttpIdentityStore } from '../../../../server/http/runtime';
import { startLocalSession, clearLocalSession } from '../../../../server/http/local-session';
import { assertRequestOrigin } from '../../../../server/http/origin';
import { errorResponse } from '../../../../server/http/errors';
export const runtime = 'nodejs';
export async function POST(request: Request): Promise<Response> {
  try {
    const cookie = await startLocalSession(request, readAuthEnvironment(), getHttpIdentityStore());
    return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': cookie, 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request): Promise<Response> {
  try {
    const env = readAuthEnvironment();
    if (env.mode !== 'local') return new Response(null, { status: 404 });
    assertRequestOrigin(request, env, true);
    return new Response(null, { status: 204, headers: { 'Set-Cookie': clearLocalSession(), 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
