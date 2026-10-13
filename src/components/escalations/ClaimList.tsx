import type { ClaimAssessment, Verdict } from '../../contracts';
import { shortDate } from '../graph/labels';
import { CitationChip, type CitedAct } from './CitationChip';

const VERDICT_MARK: Record<Verdict, string> = { supported: '✓', contradicted: '✕', contested: '±', insufficient: '?' };

function Cites({ title, actIds, acts }: { title: string; actIds: string[]; acts: Readonly<Record<string, CitedAct>> }) {
  return (
    <div>
      <h4>{title}</h4>
      {actIds.length ? actIds.map(id => <div key={id}><CitationChip actId={id} acts={acts} /></div>) : <span className="faint">none</span>}
    </div>
  );
}

export function ClaimList({ claims, acts }: { claims: ClaimAssessment[]; acts: Readonly<Record<string, CitedAct>> }) {
  return (
    <div className="stack">
      <ol className="claims" aria-label="Claims">
        {claims.map((claim, index) => (
          <li key={claim.id} className="claim">
            <div className="row">
              <b style={{ flex: 1, minWidth: 0 }}>Claim {index + 1}: {claim.text}</b>
              <span className={`verdict v-${claim.verdict}`} data-testid="verdict"><span aria-hidden="true">{VERDICT_MARK[claim.verdict]}</span> {claim.verdict}</span>
            </div>
            <span className="faint" style={{ fontSize: 12 }}>Type: {claim.type}{claim.timeWindow ? `, ${shortDate(claim.timeWindow.start)} to ${shortDate(claim.timeWindow.end)}` : ''}</span>
            <div className="cites">
              <Cites title="Supporting acts" actIds={claim.supportingActIds} acts={acts} />
              <Cites title="Contradicting acts" actIds={claim.contradictingActIds} acts={acts} />
            </div>
            {claim.openQuestions.map((question, position) => <p key={position} className="faint" style={{ fontSize: 12 }}>Open question: {question}</p>)}
          </li>
        ))}
      </ol>
      <p className="faint" style={{ fontSize: 11.5 }}>Verdict rule: support only = supported, contradiction only = contradicted, both = contested, neither = insufficient. The verdict classifies the cited evidence; it does not verify the truth.</p>
    </div>
  );
}
