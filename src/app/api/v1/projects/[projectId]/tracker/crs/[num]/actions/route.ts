import { asMember } from '../../../../../../../../../server/http/act-as';
import { route } from '../../../../../../../../../server/http/route';
import { crAction } from '../../../../../../../../../server/tracker';
export const runtime = 'nodejs';
export const POST = route(asMember(crAction));
