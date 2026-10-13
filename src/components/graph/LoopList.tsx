'use client';
import type { DerivedLoop } from '../../contracts/engine';
import type { Milestone } from '../../contracts/graph';
import { ACT_LABEL, BREAKDOWN_LABEL, STATE_COLOR, dueLabel, partyName, shortStamp, stateLabel, type Directory } from './labels';

type Props = { loops: readonly DerivedLoop[]; directory: Directory; milestones: readonly Milestone[]; timeZone: string; onOpen(loopId: string): void };

export function LoopList({ loops, directory, milestones, timeZone, onOpen }: Props) {
  const milestoneName = new Map(milestones.map(item => [item.id, item.name]));
  return (
    <div className="tablewrap">
      <table>
        <caption className="sr">Loops</caption>
        <thead><tr><th scope="col">Title</th><th scope="col">Performer department</th><th scope="col">Customer</th><th scope="col">Due</th><th scope="col">State</th><th scope="col">Breakdowns</th><th scope="col">Milestone</th><th scope="col">Last act</th></tr></thead>
        <tbody>
          {loops.map(loop => {
            const last = loop.acts.at(-1);
            return (
              <tr key={loop.loop.id}>
                <td><button type="button" onClick={() => onOpen(loop.loop.id)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 700, color: 'var(--ink)' }}>{loop.loop.title}</button></td>
                <td>{directory.departments.get(loop.loop.performerDepartmentId)?.name ?? 'Unknown'}</td>
                <td>{partyName(loop.loop.customer, directory)}</td>
                <td>{dueLabel(loop.due)}</td>
                <td><span className="st" style={{ '--c': loop.state ? STATE_COLOR[loop.state] : 'var(--isolated)' } as React.CSSProperties}>{stateLabel(loop.state)}</span></td>
                <td><div className="row" style={{ gap: 4 }}>{loop.breakdowns.length ? loop.breakdowns.map(item => <span key={item.type} className={`bd ${item.severity}`} title={item.sentence}>{item.severity === 'broken' ? '✕' : '!'} {BREAKDOWN_LABEL[item.type]}</span>) : <span className="faint">none</span>}</div></td>
                <td>{loop.loop.milestoneId ? milestoneName.get(loop.loop.milestoneId) ?? 'Unknown' : 'none'}</td>
                <td>{last ? `${ACT_LABEL[last.type]}, ${shortStamp(last.occurredAt, timeZone)}` : 'no acts yet'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {loops.length === 0 && <p className="faint" style={{ padding: '12px 14px', fontSize: 13 }}>No loop matches these filters.</p>}
    </div>
  );
}
