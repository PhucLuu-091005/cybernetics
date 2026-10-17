import { asMember } from '../../../../../../server/http/act-as';
import { route } from '../../../../../../server/http/route';
import { addTeam } from '../../../../../../server/tracker';
export const runtime = 'nodejs';
export const POST = route(asMember(addTeam), { status: 201 });
