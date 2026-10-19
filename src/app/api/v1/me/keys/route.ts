import { createUserKey, listUserKeys } from '../../../../../server/app';
import { keyActsAs } from '../../../../../server/http/act-as';
import { route } from '../../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route((ctx, _request, _params, input) =>
  listUserKeys(ctx, input as Parameters<typeof listUserKeys>[1]),
);
/** `?project=` names the page the key is made on, whose person on screen the key acts as. */
export const POST = route(
  async (ctx, request, _params, input) =>
    createUserKey(
      ctx,
      input as Parameters<typeof createUserKey>[1],
      await keyActsAs(request, ctx, new URL(request.url).searchParams.get('project')),
    ),
  { status: 201 },
);
