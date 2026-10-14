import { getCommit } from '../../../../../../../server/domain/commits';
import { domain, route } from '../../../../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route(domain(getCommit));
