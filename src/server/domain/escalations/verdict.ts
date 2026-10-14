import type { ClaimAssessment, ClaimInput, Verdict } from '../../../contracts';

export function deriveVerdict(claim: ClaimInput): Verdict {
  const supported = claim.supportingActIds.length > 0,
    contradicted = claim.contradictingActIds.length > 0;
  if (supported) return contradicted ? 'contested' : 'supported';
  return contradicted ? 'contradicted' : 'insufficient';
}
export function assessClaims(claims: readonly ClaimInput[]): ClaimAssessment[] {
  return claims.map(
    ({ id, text, type, timeWindow, supportingActIds, contradictingActIds, openQuestions }) => {
      const claim = {
        id,
        text,
        type,
        timeWindow,
        supportingActIds,
        contradictingActIds,
        openQuestions,
      };
      return { ...claim, verdict: deriveVerdict(claim) };
    },
  );
}
