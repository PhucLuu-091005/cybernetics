import { asMember } from '../../../../../../../../../../server/http/act-as';
import { route } from '../../../../../../../../../../server/http/route';
import { removeOp } from '../../../../../../../../../../server/tracker';
export const runtime = 'nodejs';
export const DELETE = route(asMember(removeOp));
