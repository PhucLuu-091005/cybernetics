import { readAuthEnvironment } from '../../../../server/env';
import { errorResponse, newRequestId } from '../../../../server/errors';
import { googleClient, startGoogleSignIn } from '../../../../server/http/google';
export const runtime = 'nodejs';
export async function GET(): Promise<Response> {
  try {
    const env = readAuthEnvironment();
    if (env.mode !== 'google') return new Response(null, { status: 404 });
    return startGoogleSignIn(env, googleClient(env));
  } catch (error) { return errorResponse(error, newRequestId()); }
}
