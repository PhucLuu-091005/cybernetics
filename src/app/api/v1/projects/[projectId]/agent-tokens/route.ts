import { createAgentToken, listAgentTokens } from '../../../../../../server/app';
import { keyActsAs } from '../../../../../../server/http/act-as';
import { route } from '../../../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route((ctx, _request, _params, input) =>
  listAgentTokens(ctx, input as Parameters<typeof listAgentTokens>[1]),
);
export const POST = route(
  async (ctx, request, params, input) =>
    createAgentToken(
      ctx,
      input as Parameters<typeof createAgentToken>[1],
      await keyActsAs(request, ctx, params.projectId),
    ),
  { status: 201 },
);
