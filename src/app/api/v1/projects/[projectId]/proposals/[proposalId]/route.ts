import { getProposal, updateProposal } from '../../../../../../../server/domain/proposals';
import { domain, route } from '../../../../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route(domain(getProposal));
export const PATCH = route(domain(updateProposal));
