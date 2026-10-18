import { createUserKey, listUserKeys } from '../../../../../server/app';
import { route } from '../../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route((ctx, _request, _params, input) =>
  listUserKeys(ctx, input as Parameters<typeof listUserKeys>[1]),
);
export const POST = route(
  (ctx, _request, _params, input) =>
    createUserKey(ctx, input as Parameters<typeof createUserKey>[1]),
  { status: 201 },
);
