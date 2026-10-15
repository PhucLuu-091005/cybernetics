import type { Node, NodeProps } from '@xyflow/react';
import type { ActGlyph } from '../../contracts/layout';
import { SCREEN_MIN } from '../../lib/graph-layout';
import { ActIconAt } from './icons';
import { useGraphUi } from './ui-context';

/** `stacked` counts the events the icon stands for when the zoom merges near icons. */
export type ActNodeType = Node<{ glyph: ActGlyph; color: string; stacked: number }, 'act'>;
export const ACT_NODE_SIZE = 24;
const ICON = 18;

/** Visual only: BranchEdge owns the hit targets so one click target covers a branch and its icons. */
export function ActNode({ data }: NodeProps<ActNodeType>) {
  const ui = useGraphUi();
  const { glyph, color, stacked } = data,
    half = ACT_NODE_SIZE / 2,
    scale = Math.max(1, SCREEN_MIN.icon / (ICON * ui.zoom)),
    r = ICON / 2 + 1;
  const faded = ui.faded.has(glyph.loopId);
  return (
    <div
      className={`act-node${ui.currentActId === glyph.id ? ' cur' : ''}`}
      style={{
        width: ACT_NODE_SIZE,
        height: ACT_NODE_SIZE,
        opacity: faded ? 0.4 : 1,
        transition: 'opacity .15s',
        color: glyph.type === 'reject' ? 'var(--danger)' : color,
      }}
    >
      <svg
        width={ACT_NODE_SIZE}
        height={ACT_NODE_SIZE}
        viewBox={`0 0 ${ACT_NODE_SIZE} ${ACT_NODE_SIZE}`}
        aria-hidden="true"
        style={{ overflow: 'visible', display: 'block' }}
      >
        <g transform={`translate(${half} ${half}) scale(${scale}) translate(${-half} ${-half})`}>
          {stacked > 1 && (
            <>
              <circle cx={half + 5} cy={half} r={r} fill="currentColor" opacity={0.22} />
              <circle cx={half + 2.5} cy={half} r={r} fill="currentColor" opacity={0.4} />
            </>
          )}
          <circle
            cx={half}
            cy={half}
            r={r}
            fill="var(--surface)"
            stroke={stacked > 1 ? 'currentColor' : undefined}
            strokeWidth={1.2}
          />
          <ActIconAt type={glyph.type} x={half} y={half} size={ICON} />
        </g>
      </svg>
    </div>
  );
}
