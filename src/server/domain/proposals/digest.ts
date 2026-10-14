import { canonicalHash } from '../../../lib/canonical-json';
import { AppError } from '../../errors';
import type { ProjectRow } from '../../db/tx';
import type { ProposalRow } from './read';

export type ReviewInputs = {
  baseCommitId: string;
  proposalRevision: number;
  mainCommitId: string;
  evidenceRevision: number;
  snapshotHash: string;
  T: string;
};
export function reviewDigest(r: ReviewInputs): string {
  return canonicalHash({
    baseCommitId: r.baseCommitId,
    proposalRevision: r.proposalRevision,
    mainCommitId: r.mainCommitId,
    evidenceRevision: r.evidenceRevision,
    snapshotHash: r.snapshotHash,
    T: r.T,
  });
}
/** A review binds main, the draft revision and the evidence revision; the draft must also have acknowledged that evidence revision (SRD 6.1). */
export function assertReviewBasis(
  project: ProjectRow,
  proposal: ProposalRow,
  expected: { mainCommitId: string; proposalRevision: number; evidenceRevision: number },
): void {
  const details = {
    actualMainCommitId: project.mainCommitId,
    actualProposalRevision: proposal.revision,
    actualEvidenceRevision: project.evidenceRevision,
    proposalEvidenceRevision: proposal.evidenceRevision,
    status: proposal.status,
  };
  const fail = (message: string) => {
    throw new AppError('CONFLICT', message, { details });
  };
  if (proposal.status !== 'draft') fail(`Proposal is ${proposal.status}, not a draft`);
  if (expected.mainCommitId !== project.mainCommitId) fail('Main moved since the expected commit');
  if (expected.proposalRevision !== proposal.revision)
    fail('Proposal changed since the expected revision');
  if (expected.evidenceRevision !== project.evidenceRevision)
    fail('Evidence changed since the expected revision');
  if (proposal.evidenceRevision !== project.evidenceRevision)
    fail(
      'New evidence is not acknowledged; update the proposal to pin the current evidence revision',
    );
}
