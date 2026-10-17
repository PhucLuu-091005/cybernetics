import { asMember } from '../../../../../../../server/http/act-as';
import { route } from '../../../../../../../server/http/route';
import { removeMember, updateMember } from '../../../../../../../server/tracker';
export const runtime = 'nodejs';
export const PATCH = route(asMember(updateMember));
export const DELETE = route(asMember(removeMember));
