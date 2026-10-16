import type { Db } from '../../../../../../../server/db/tx';
import type { ActorContext } from '../../../../../../../contracts';
import { asMember } from '../../../../../../../server/http/act-as';
import { route } from '../../../../../../../server/http/route';
import { createCr } from '../../../../../../../server/tracker';
export const runtime = 'nodejs';
// Every tracker write answers with a payload the browser can swap in; creation adds the new number.
async function create(db: Db, ctx: ActorContext, input: Parameters<typeof createCr>[2]) {
  const { num, payload } = await createCr(db, ctx, input);
  return { ...payload, num };
}
export const POST = route(asMember(create), { status: 201 });
