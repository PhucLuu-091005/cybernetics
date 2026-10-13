import type { BreakdownType, LoopState, ProposalReview } from '../../contracts';
import { BREAKDOWN_LABEL, stateLabel } from '../graph/labels';

const label = (type: string) => BREAKDOWN_LABEL[type as BreakdownType] ?? type.replaceAll('_', ' ');
const state = (value: string | null) => value === null ? 'not in graph' : stateLabel(value as LoopState);

/** SRD 6.2: state and breakdown changes of the candidate against main, both evaluated at the same T. */
export function EffectsTable({ effects, loopTitles, T }: { effects: ProposalReview['effects']; loopTitles: Record<string, string>; T: string }) {
  return (
    <section className="card pad" aria-labelledby="effects-heading">
      <h2 id="effects-heading" style={{ marginBottom: 8 }}>Effects at T = {T}</h2>
      {effects.length === 0 ? <p className="faint" style={{ fontSize: 13 }}>No loop changes state or breakdowns at T.</p> : (
        <div className="tablewrap" style={{ border: 0 }}>
          <table>
            <thead><tr><th>Loop</th><th>State</th><th>Breakdowns</th></tr></thead>
            <tbody>
              {effects.map(effect => (
                <tr key={effect.loopId}>
                  <td>{loopTitles[effect.loopId] ?? effect.loopId.slice(0, 8)}</td>
                  <td>{effect.beforeState === effect.afterState ? state(effect.afterState) : <>{state(effect.beforeState)} → <b>{state(effect.afterState)}</b></>}</td>
                  <td>
                    {effect.removedBreakdowns.map(type => <span key={`r-${type}`} style={{ marginRight: 8 }}><del>✕ {label(type)}</del> resolved</span>)}
                    {effect.addedBreakdowns.map(type => <span key={`a-${type}`} className="bad" style={{ marginRight: 8 }}>✕ {label(type)} new</span>)}
                    {!effect.removedBreakdowns.length && !effect.addedBreakdowns.length && <span className="faint">unchanged</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
