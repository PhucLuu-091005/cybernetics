import { listEscalations, openEscalation } from '../../../../../../server/domain/escalations';
import { domain, route } from '../../../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route(domain(listEscalations));
export const POST = route(domain(openEscalation), { status: 201 });
