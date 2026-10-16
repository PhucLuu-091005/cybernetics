import { setActingMember } from '../../../../../../../server/http/act-as';
import { route } from '../../../../../../../server/http/route';
export const runtime = 'nodejs';
export const POST = route(setActingMember);
