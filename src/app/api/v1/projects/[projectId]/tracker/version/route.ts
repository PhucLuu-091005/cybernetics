import { asMember } from '../../../../../../../server/http/act-as';
import { route } from '../../../../../../../server/http/route';
import { getTrackerVersion } from '../../../../../../../server/tracker';
export const runtime = 'nodejs';
export const GET = route(asMember(getTrackerVersion), { bucket: 'poll' });
