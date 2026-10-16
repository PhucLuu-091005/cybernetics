import { asMember } from '../../../../../../../../../server/http/act-as';
import { route } from '../../../../../../../../../server/http/route';
import { appendOp } from '../../../../../../../../../server/tracker';
export const runtime = 'nodejs';
export const POST = route(asMember(appendOp));
