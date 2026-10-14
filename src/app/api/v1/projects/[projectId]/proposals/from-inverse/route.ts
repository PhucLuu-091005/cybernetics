import { proposalFromInverse } from '../../../../../../../server/domain/commits';
import { domain, route } from '../../../../../../../server/http/route';
export const runtime = 'nodejs';
export const POST = route(domain(proposalFromInverse), { status: 201 });
