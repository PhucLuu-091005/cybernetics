import { readAuthEnvironment } from '../../../../server/env';
import { errorResponse, newRequestId } from '../../../../server/errors';
import { getHttpIdentityStore } from '../../../../server/http/runtime';
import { startLocalSession } from '../../../../server/http/session';
export const runtime = 'nodejs';
export async function POST(request: Request): Promise<Response> {
  try {
    const cookie = await startLocalSession(request, readAuthEnvironment(), getHttpIdentityStore());
    return new Response(null, {
      status: 303,
      headers: { Location: '/', 'Set-Cookie': cookie, 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return errorResponse(error, newRequestId());
  }
}
