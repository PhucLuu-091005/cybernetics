import { asMember } from '../../../../../../server/http/act-as';
import { route } from '../../../../../../server/http/route';
import { inviteMember, listProjectMembers } from '../../../../../../server/tracker';
export const runtime = 'nodejs';
export const GET = route(asMember(listProjectMembers));
export const POST = route(asMember(inviteMember), { status: 201 });
