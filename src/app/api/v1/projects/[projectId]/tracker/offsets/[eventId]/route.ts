import { asMember } from '../../../../../../../../server/http/act-as';
import { route } from '../../../../../../../../server/http/route';
import { setEventOffset } from '../../../../../../../../server/tracker';
export const runtime = 'nodejs';
export const PUT = route(asMember(setEventOffset));
