import { getProject } from '../../../../../server/domain/projects';
import { domain, route } from '../../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route(domain(getProject));
