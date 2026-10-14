import { getApp } from '../../../../../server/app';
import { readAuthEnvironment } from '../../../../../server/env';
import { errorResponse, newRequestId } from '../../../../../server/errors';
import { completeGoogleSignIn, googleClient } from '../../../../../server/http/google';
export const runtime = 'nodejs';
export async function GET(request: Request): Promise<Response> {
  try {
    const env = readAuthEnvironment();
    if (env.mode !== 'google') return new Response(null, { status: 404 });
    return await completeGoogleSignIn(request, env, getApp().identity, googleClient(env));
  } catch (error) {
    return errorResponse(error, newRequestId());
  }
}
