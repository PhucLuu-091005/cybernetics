import { createProposal, listProposals } from '../../../../../../server/domain/proposals';
import { domain, route } from '../../../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route(domain(listProposals));
export const POST = route(domain(createProposal), { status: 201 });
