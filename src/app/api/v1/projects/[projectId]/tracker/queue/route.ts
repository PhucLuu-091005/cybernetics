import { asMember } from '../../../../../../../server/http/act-as';
import { route } from '../../../../../../../server/http/route';
import { addQueueEntry } from '../../../../../../../server/tracker';
export const runtime = 'nodejs';
export const POST = route(asMember(addQueueEntry), { status: 201 });
