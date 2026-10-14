import { getLoop } from '../../../../../../../server/domain/graph';
import { domain, route, withView } from '../../../../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route(domain(getLoop, withView));
