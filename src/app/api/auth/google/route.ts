import { readAuthEnvironment } from '../../../../server/env';
import { errorResponse, newRequestId } from '../../../../server/errors';
import { googleClient, startGoogleSignIn } from '../../../../server/http/google';
import { returnPath } from '../../../../server/http/return-path';
export const runtime = 'nodejs';
export async function GET(request: Request): Promise<Response> {
  try {
    const env = readAuthEnvironment();
    if (env.mode !== 'google') return new Response(null, { status: 404 });
    return startGoogleSignIn(
      env,
      googleClient(env),
      returnPath(new URL(request.url).searchParams.get('next')),
    );
  } catch (error) {
    return errorResponse(error, newRequestId());
  }
}
