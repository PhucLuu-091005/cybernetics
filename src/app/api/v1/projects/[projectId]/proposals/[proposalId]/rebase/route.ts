import { applyRebase } from '../../../../../../../../server/domain/proposals';
import { domain, route } from '../../../../../../../../server/http/route';
export const runtime = 'nodejs';
export const POST = route(domain(applyRebase));
