import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getApp, tokenActor } from '../../server/app';
import { errorResponse, newRequestId } from '../../server/errors';
import { MAX_BODY_BYTES } from '../../server/http/route';
import { createMcpServer } from '../../server/mcp/server';
export const runtime = 'nodejs';
// A 2 MiB import envelope plus its JSON-RPC wrapper must still fit.
const MAX_REQUEST_BYTES = MAX_BODY_BYTES + 64 * 1024;
// Scope is checked per tool, so a token without project:read can still call import_records.
export async function POST(request: Request): Promise<Response> {
  let requestId: string = newRequestId();
  try {
    const ctx = await tokenActor(request, null);
    requestId = ctx.requestId;
    const server = createMcpServer(ctx, getApp().db);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MAX_REQUEST_BYTES });
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) { return errorResponse(error, requestId); }
}
const notAllowed = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
export function GET(): Response { return notAllowed(); }
export function DELETE(): Response { return notAllowed(); }
