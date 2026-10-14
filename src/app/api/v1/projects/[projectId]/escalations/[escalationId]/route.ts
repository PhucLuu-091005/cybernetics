import { getEscalation } from '../../../../../../../server/domain/escalations';
import { domain, route } from '../../../../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route(domain(getEscalation));
