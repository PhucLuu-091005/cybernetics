import { revokeAgentToken } from '../../../../../../../server/app';
import { route } from '../../../../../../../server/http/route';
export const runtime = 'nodejs';
export const DELETE = route((ctx, _request, _params, input) =>
  revokeAgentToken(ctx, input as Parameters<typeof revokeAgentToken>[1]),
);
