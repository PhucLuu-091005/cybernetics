import { revokeUserKey } from '../../../../../../server/app';
import { route } from '../../../../../../server/http/route';
export const runtime = 'nodejs';
export const DELETE = route((ctx, _request, _params, input) =>
  revokeUserKey(ctx, input as Parameters<typeof revokeUserKey>[1]),
);
