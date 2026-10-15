import type { Node, NodeProps } from '@xyflow/react';
import type { ActGlyph } from '../../contracts/layout';
import { ActIconAt } from './icons';
import { useGraphUi } from './ui-context';

export type ActNodeType = Node<{ glyph: ActGlyph; color: string }, 'act'>;
export const ACT_NODE_SIZE = 24;
const ICON = 18;

/** Visual only: BranchEdge owns the hit targets so one click target covers a branch and its icons. */
export function ActNode({ data }: NodeProps<ActNodeType>) {
  const ui = useGraphUi();
  const { glyph, color } = data,
    half = ACT_NODE_SIZE / 2;
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
        <circle cx={half} cy={half} r={ICON / 2 + 1} fill="var(--surface)" />
        <ActIconAt type={glyph.type} x={half} y={half} size={ICON} />
      </svg>
    </div>
  );
}
