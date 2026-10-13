import type { Node, NodeProps } from '@xyflow/react';
import type { ActGlyph } from '../../contracts/layout';
import { Glyph } from './Glyph';
import { useGraphUi } from './ui-context';

export type ActNodeType = Node<{ glyph: ActGlyph; color: string }, 'act'>;
export const ACT_NODE_SIZE = 22;

/** Visual only: BranchEdge owns the hit targets so one click target covers a branch and its glyphs. */
export function ActNode({ data }: NodeProps<ActNodeType>) {
  const ui = useGraphUi();
  const { glyph, color } = data, half = ACT_NODE_SIZE / 2;
  const faded = ui.faded.has(glyph.loopId);
  return (
    <div className={`act-node${ui.currentActId === glyph.id ? ' cur' : ''}`} style={{ width: ACT_NODE_SIZE, height: ACT_NODE_SIZE, opacity: faded ? 0.4 : 1, transition: 'opacity .15s' }}>
      <svg width={ACT_NODE_SIZE} height={ACT_NODE_SIZE} viewBox={`0 0 ${ACT_NODE_SIZE} ${ACT_NODE_SIZE}`} aria-hidden="true" style={{ overflow: 'visible', display: 'block' }}>
        <Glyph type={glyph.type} x={half} y={half} color={color} />
        {ui.zoomLevel === 'detail' && <text x={half} y={half - 10} textAnchor="middle" fontSize="10" fill="var(--ink-2)">{glyph.label}</text>}
      </svg>
    </div>
  );
}
