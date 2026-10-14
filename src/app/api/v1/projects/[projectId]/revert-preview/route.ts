import { previewRevert } from '../../../../../../server/domain/commits';
import { domain, route } from '../../../../../../server/http/route';
export const runtime = 'nodejs';
export const POST = route(domain(previewRevert));
