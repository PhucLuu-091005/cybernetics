import { withdrawRecord } from '../../../../../../../server/domain/records';
import { domain, route } from '../../../../../../../server/http/route';
export const runtime = 'nodejs';
export const PATCH = route(domain(withdrawRecord));
