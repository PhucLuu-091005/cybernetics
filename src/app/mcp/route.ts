import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getApp, tokenActor } from '../../server/app';
import { errorResponse, newRequestId } from '../../server/errors';
import { MAX_BODY_BYTES } from '../../server/http/route';
import { createMcpServer } from '../../server/mcp/server';
export const runtime = 'nodejs';
// A tool call may carry a body as large as a REST call, plus its JSON-RPC wrapper.
const MAX_REQUEST_BYTES = MAX_BODY_BYTES + 64 * 1024;
// Tool results carry event text and project data, so they get the same cache headers as REST (SRD 17).
function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Vary', 'Authorization');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
// Scope is checked per tool, so a token without project:read can still call add_queue_event.
export async function POST(request: Request): Promise<Response> {
  let requestId: string = newRequestId();
  try {
    const ctx = await tokenActor(request, null);
    requestId = ctx.requestId;
    const server = createMcpServer(ctx, getApp().db);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: MAX_REQUEST_BYTES,
    });
    await server.connect(transport);
    return privateResponse(await transport.handleRequest(request));
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
const notAllowed = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
export function GET(): Response {
  return notAllowed();
}
export function DELETE(): Response {
  return notAllowed();
}
