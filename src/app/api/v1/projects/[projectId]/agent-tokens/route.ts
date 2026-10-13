import { createAgentToken, listAgentTokens } from '../../../../../../server/app';
import { route } from '../../../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route((ctx, _request, _params, input) => listAgentTokens(ctx, input as Parameters<typeof listAgentTokens>[1]));
export const POST = route((ctx, _request, _params, input) => createAgentToken(ctx, input as Parameters<typeof createAgentToken>[1]), { status: 201 });
