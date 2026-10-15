import type { Node, NodeProps } from '@xyflow/react';
import type { GatewayLayout } from '../../contracts/layout';
import { SCREEN_MIN } from '../../lib/graph-layout';
import { useGraphUi } from './ui-context';

export type GatewayNodeType = Node<{ gateway: GatewayLayout }, 'gateway'>;
export const GATEWAY_SIZE = 24;

// Lucide 1.48 split, arrow-right-left and git-merge (ISC licence); the join mark is our own.
const ICON: Record<GatewayLayout['kind'], string[]> = {
  split: ['M16 3h5v5', 'M8 3H3v5', 'M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3', 'm15 9 6-6'],
  handoff: ['m16 3 4 4-4 4', 'M20 7H4', 'm8 21-4-4 4-4', 'M4 17h16'],
  join: ['M3 5c6 0 7 7 12 7', 'M3 19c6 0 7-7 12-7', 'M3 12h18', 'm17 8 4 4-4 4'],
  return: [
    'M6 21V9a9 9 0 0 0 9 9',
    'M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  ],
};

/** A diamond where work changes hands; its native tooltip names the loops on both sides. */
export function GatewayNode({ data }: NodeProps<GatewayNodeType>) {
  const { gateway } = data,
    half = GATEWAY_SIZE / 2,
    scale = Math.max(1, SCREEN_MIN.icon / (16 * useGraphUi().zoom));
  return (
    <svg
      width={GATEWAY_SIZE}
      height={GATEWAY_SIZE}
      role="img"
      aria-label={gateway.accessibleName}
      className={`gateway ${gateway.kind}${gateway.pending ? ' pending' : ''}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <title>{gateway.accessibleName}</title>
      <g transform={`translate(${half} ${half}) scale(${scale}) translate(${-half} ${-half})`}>
        <rect
          x={half - 8}
          y={half - 8}
          width={16}
          height={16}
          rx={3}
          transform={`rotate(45 ${half} ${half})`}
        />
        <g
          transform={`translate(${half - 5} ${half - 5}) scale(${10 / 24})`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {ICON[gateway.kind].map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </g>
    </svg>
  );
}
