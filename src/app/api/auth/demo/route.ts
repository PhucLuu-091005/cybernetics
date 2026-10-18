import { getApp } from '../../../../server/app';
import { readAuthEnvironment } from '../../../../server/env';
import { errorResponse, newRequestId } from '../../../../server/errors';
import { enterDemo, restartDemo } from '../../../../server/http/demo';
import { getRateLimiter } from '../../../../server/http/runtime';
export const runtime = 'nodejs';

const deps = () => ({
  env: readAuthEnvironment(),
  store: getApp().identity,
  limiter: getRateLimiter(),
});
const redirect = ({ location, cookie }: { location: string; cookie?: string }) =>
  new Response(null, {
    status: 303,
    headers: {
      Location: location,
      'Cache-Control': 'private, no-store',
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  });

export async function GET(request: Request): Promise<Response> {
  try {
    return redirect(await enterDemo(request, deps()));
  } catch (error) {
    return errorResponse(error, newRequestId());
  }
}
export const HEAD = GET;

export async function POST(request: Request): Promise<Response> {
  try {
    return redirect(await restartDemo(request, deps()));
  } catch (error) {
    // Start over is a form post, so a refusal is a line that the person reads, not JSON.
    const status = errorResponse(error, newRequestId()).status;
    return new Response('Start over did not work. Open the demo again.', {
      status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'private, no-store',
      },
    });
  }
}
