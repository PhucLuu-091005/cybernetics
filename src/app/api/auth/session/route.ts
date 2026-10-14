import { readAuthEnvironment } from '../../../../server/env';
import { errorResponse, newRequestId } from '../../../../server/errors';
import { assertRequestOrigin } from '../../../../server/http/origin';
import { clearSessionCookie } from '../../../../server/http/session';
export const runtime = 'nodejs';
export async function DELETE(request: Request): Promise<Response> {
  try {
    assertRequestOrigin(request, readAuthEnvironment(), true);
    return new Response(null, {
      status: 204,
      headers: { 'Set-Cookie': clearSessionCookie(), 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return errorResponse(error, newRequestId());
  }
}
