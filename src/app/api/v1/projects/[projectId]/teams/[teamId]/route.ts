import { asMember } from '../../../../../../../server/http/act-as';
import { route } from '../../../../../../../server/http/route';
import { deleteTeam, updateTeam } from '../../../../../../../server/tracker';
export const runtime = 'nodejs';
export const PATCH = route(asMember(updateTeam));
export const DELETE = route(asMember(deleteTeam));
