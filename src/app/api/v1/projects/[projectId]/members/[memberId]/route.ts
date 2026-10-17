import { asMember } from '../../../../../../../server/http/act-as';
import { route } from '../../../../../../../server/http/route';
import { changeMemberRole, removeMember } from '../../../../../../../server/tracker';
export const runtime = 'nodejs';
export const PATCH = route(asMember(changeMemberRole));
export const DELETE = route(asMember(removeMember));
