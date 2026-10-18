import { getApp } from '../../../../server/app';
import { readAuthEnvironment } from '../../../../server/env';
import { errorResponse, newRequestId } from '../../../../server/errors';
import { returnPath } from '../../../../server/http/return-path';
import { startLocalSession } from '../../../../server/http/session';
export const runtime = 'nodejs';
export async function POST(request: Request): Promise<Response> {
  try {
    const cookie = await startLocalSession(request, readAuthEnvironment(), getApp().identity);
    const next = returnPath(new URL(request.url).searchParams.get('next')) ?? '/';
    return new Response(null, {
      status: 303,
      headers: { Location: next, 'Set-Cookie': cookie, 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return errorResponse(error, newRequestId());
  }
}
