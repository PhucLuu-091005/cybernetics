import { diffProposal, reviewProposal } from '../../../../../../../../server/domain/proposals';
import { domain, route } from '../../../../../../../../server/http/route';
export const runtime = 'nodejs';
const review = domain(reviewProposal),
  current = domain(diffProposal);
const EXPECTED = ['expectedMainCommitId', 'expectedProposalRevision', 'expectedEvidenceRevision'];
export const GET = route((ctx, request, params, input) =>
  (EXPECTED.some((key) => input[key] !== undefined) ? review : current)(
    ctx,
    request,
    params,
    input,
  ),
);
