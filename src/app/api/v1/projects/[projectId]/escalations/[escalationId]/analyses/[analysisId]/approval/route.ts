import { approveAnswer } from '../../../../../../../../../../server/domain/escalations';
import { domain, route } from '../../../../../../../../../../server/http/route';
export const runtime = 'nodejs';
export const POST = route(domain(approveAnswer));
