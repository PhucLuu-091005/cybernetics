import { getApp } from '../../../../server/app';
import { readAuthEnvironment } from '../../../../server/env';
import { errorResponse, newRequestId } from '../../../../server/errors';
import { enterDemo, restartDemo, type DemoAnswer } from '../../../../server/http/demo';
import { getRateLimiter } from '../../../../server/http/runtime';
export const runtime = 'nodejs';

async function answer(request: Request, work: typeof enterDemo): Promise<Response> {
  try {
    const { location, cookie }: DemoAnswer = await work(request, {
      env: readAuthEnvironment(),
      store: getApp().identity,
      limiter: getRateLimiter(),
    });
    return new Response(null, {
      status: 303,
      headers: {
        Location: location,
        'Cache-Control': 'private, no-store',
        ...(cookie ? { 'Set-Cookie': cookie } : {}),
      },
    });
  } catch (error) {
    return errorResponse(error, newRequestId());
  }
}
export const GET = (request: Request) => answer(request, enterDemo);
export const HEAD = GET;
export const POST = (request: Request) => answer(request, restartDemo);
