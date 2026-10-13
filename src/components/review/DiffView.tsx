import { Fragment } from 'react';
import type { Act, EntityChange, RecordDecision } from '../../contracts';
import { changeClass, changeSymbol, entityTitle, fieldLines, newestImage, summarizeEntity, type Names } from './describe';

const MAX_ROWS = 200;

export function ChangeCells({ change, names }: { change: EntityChange; names: Names }) {
  if (change.kind !== 'changed') {
    return <><td className={change.kind === 'added' ? 'faint' : undefined}>{change.kind === 'added' ? 'none' : summarizeEntity(change.collection, change.before, names)}</td><td className={change.kind === 'removed' ? 'faint' : undefined}>{change.kind === 'removed' ? 'none' : summarizeEntity(change.collection, change.after, names)}</td></>;
  }
  const [before, after] = fieldLines(change.collection, [change.before, change.after], names);
  const cell = (lines: typeof before, Mark: 'del' | 'ins') => <td>{lines.map((line, index) => <Fragment key={line.field}>{index > 0 && <br />}{line.label && `${line.label} `}<Mark>{line.value}</Mark></Fragment>)}</td>;
  return <>{cell(before, 'del')}{cell(after, 'ins')}</>;
}

function loopOf(change: EntityChange, names: Names): string | null {
  if (change.collection !== 'acts') return null;
  const act = newestImage(change.after, change.before) as Act | null;
  return act ? `loop ${act.loopId === null ? 'none' : names.loops[act.loopId] ?? 'unknown'}` : null;
}

/** SRD 6.2: entity additions, removals and changes with before and after values; record decisions get their own list. */
export function DiffView({ changes, names, pendingEvidenceCount }: { changes: readonly EntityChange[]; names: Names; pendingEvidenceCount?: number }) {
  const structural = changes.filter(change => change.collection !== 'recordDecisions');
  const decisions = changes.filter(change => change.collection === 'recordDecisions');
  return (
    <>
      <section className="card pad" aria-labelledby="diff-structural">
        <h2 id="diff-structural" style={{ marginBottom: 8 }}>Structural changes</h2>
        {structural.length === 0 ? <p className="faint" style={{ fontSize: 13 }}>No entity changes.</p> : (
          <div className="tablewrap" style={{ border: 0 }}>
            <table>
              <thead><tr><th>Entity</th><th>Change</th><th>Before</th><th>After</th></tr></thead>
              <tbody>
                {structural.slice(0, MAX_ROWS).map(change => {
                  const sub = loopOf(change, names);
                  return (
                    <tr key={`${change.collection}/${change.id}`}>
                      <td>{entityTitle(change.collection, change.id, newestImage(change.after, change.before), names)}{sub && <><br /><span className="faint">{sub}</span></>}</td>
                      <td><span className={`change ${changeClass(change.kind)}`}>{changeSymbol(change.kind)}</span></td>
                      <ChangeCells change={change} names={names} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {structural.length > MAX_ROWS && <p className="faint" style={{ fontSize: 12, padding: '6px 10px' }}>{structural.length - MAX_ROWS} more changes are not listed.</p>}
          </div>
        )}
      </section>
      <section className="card pad" aria-labelledby="diff-decisions">
        <h2 id="diff-decisions" style={{ marginBottom: 8 }}>Record decisions</h2>
        <ul className="plain-list">
          {decisions.slice(0, MAX_ROWS).map(change => {
            const decision = change.after as RecordDecision | null, title = names.records[change.id] ?? `record ${change.id.slice(0, 8)}`;
            return <li key={change.id}>{decision === null ? `Back to pending: ${title}` : decision.disposition === 'included' ? `Included: ${title}` : `Ignored: ${title} (${decision.reason})`}</li>;
          })}
          {decisions.length === 0 && <li className="faint">No record decision changes.</li>}
          {pendingEvidenceCount !== undefined && pendingEvidenceCount > 0 && <li className="faint">Pending, not part of this view: {pendingEvidenceCount} {pendingEvidenceCount === 1 ? 'record' : 'records'} on main.</li>}
        </ul>
      </section>
    </>
  );
}
