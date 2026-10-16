import { asMember } from '../../../../../../server/http/act-as';
import { route } from '../../../../../../server/http/route';
import { getTrackerPayload } from '../../../../../../server/tracker';
export const runtime = 'nodejs';
export const GET = route(asMember(getTrackerPayload));
