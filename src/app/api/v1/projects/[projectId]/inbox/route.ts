import { listInbox } from '../../../../../../server/domain/inbox';
import { domain, route } from '../../../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route(domain(listInbox));
