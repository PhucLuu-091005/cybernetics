'use client';
import type { DerivedLoop, DerivedMilestone } from '../../contracts/engine';
import { MILESTONE_STATUS_LABEL, milestoneLoopCounts, shortDate, stateLabel } from './labels';
import { ProblemTag } from './ProblemTag';

type Props = {
  milestone: DerivedMilestone;
  loops: readonly DerivedLoop[];
  onOpenLoop(loopId: string): void;
  onClose(): void;
};
const STATUS_COLOR = {
  reached: 'var(--proceed)',
  blocked: 'var(--danger)',
  at_risk: 'var(--caution)',
  on_track: 'var(--route)',
} as const;

export function MilestonePanel({ milestone, loops, onOpenLoop, onClose }: Props) {
  const { milestone: entity, status, reason, currentDate } = milestone;
  const assigned = loops.filter((loop) => milestone.loopIds.includes(loop.loop.id));
  const counts = milestoneLoopCounts(assigned);
  return (
    <aside className="drawer" role="complementary" aria-label="Milestone panel">
      <div className="drawer-h">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ marginBottom: 6 }}>{entity.name}</h2>
          <span className="st" style={{ '--c': STATUS_COLOR[status] } as React.CSSProperties}>
            {MILESTONE_STATUS_LABEL[status]}
          </span>
        </div>
        <button
          className="btn btn-quiet"
          type="button"
          onClick={onClose}
          aria-label="Close milestone panel"
        >
          ✕
        </button>
      </div>
      <div className="drawer-b">
        <p style={{ fontSize: 13 }}>{reason}</p>
        <dl className="kv">
          <dt>Planned</dt>
          <dd>{shortDate(entity.plannedDate)}</dd>
          <dt>Current</dt>
          <dd>
            {shortDate(currentDate)}
            {currentDate !== entity.plannedDate && <span className="faint"> (moved)</span>}
          </dd>
          <dt>Loops</dt>
          <dd>
            {counts.open} open, {counts.broken} broken
          </dd>
        </dl>
        <div>
          <h3 style={{ marginBottom: 8 }}>Assigned loops</h3>
          {assigned.length === 0 ? (
            <p className="faint" style={{ fontSize: 13 }}>
              No loop is assigned to this milestone.
            </p>
          ) : (
            <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6 }}>
              {assigned.map((loop) => (
                <li key={loop.loop.id} className="row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    style={{ padding: '2px 0', color: 'var(--route)' }}
                    onClick={() => onOpenLoop(loop.loop.id)}
                  >
                    {loop.loop.title}
                  </button>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {stateLabel(loop.state)}
                  </span>
                  {loop.breakdowns.map((item) => (
                    <ProblemTag loop={loop} item={item} key={item.type} />
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
