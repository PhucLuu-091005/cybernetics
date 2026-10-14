import type { Node, NodeProps } from '@xyflow/react';
import type { MilestoneStatus } from '../../contracts/engine';
import type { MilestoneLayout } from '../../contracts/layout';
import { milestoneKey, useGraphUi } from './ui-context';

export type MilestoneNodeType = Node<
  { milestone: MilestoneLayout; status: MilestoneStatus; index: number },
  'milestone'
>;
export const MILESTONE_NODE = { width: 160, height: 76 };

export function MilestoneNode({ data }: NodeProps<MilestoneNodeType>) {
  const ui = useGraphUi();
  const { milestone, status, index } = data,
    key = milestoneKey(milestone.id);
  const x = MILESTONE_NODE.width / 2,
    y = MILESTONE_NODE.height / 2,
    size = 9;
  const stroke =
    status === 'blocked'
      ? 'var(--danger)'
      : status === 'at_risk'
        ? 'var(--caution)'
        : 'var(--trunk)';
  const below = index % 2 === 1;
  return (
    <svg
      width={MILESTONE_NODE.width}
      height={MILESTONE_NODE.height}
      style={{ overflow: 'visible', display: 'block', pointerEvents: 'none' }}
    >
      <g
        className="ms"
        role="button"
        tabIndex={ui.activeKey === key ? 0 : -1}
        data-nav-key={key}
        aria-label={milestone.accessibleName}
        aria-pressed={ui.selectedMilestoneId === milestone.id}
        onClick={() => ui.selectMilestone(milestone.id)}
        onKeyDown={(event) => ui.navKeyDown(event, key)}
        onFocus={(event) => ui.navFocus(event, key)}
        style={{ pointerEvents: 'all' }}
      >
        <rect x={x - 14} y={y - 14} width={28} height={28} fill="transparent" />
        <polygon
          className="dia"
          points={`${x},${y - size} ${x + size},${y} ${x},${y + size} ${x - size},${y}`}
          fill={status === 'reached' ? 'var(--trunk)' : 'var(--surface)'}
          stroke={stroke}
          strokeWidth={2.4}
        />
        {status === 'blocked' && (
          <path
            d={`M${x - 3} ${y - 3} L${x + 3} ${y + 3} M${x - 3} ${y + 3} L${x + 3} ${y - 3}`}
            stroke="var(--danger)"
            strokeWidth={1.8}
          />
        )}
        <text
          className="ms-name"
          x={x}
          y={below ? y + 22 : y - 14}
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill="var(--ink)"
        >
          {milestone.label}
        </text>
      </g>
    </svg>
  );
}
