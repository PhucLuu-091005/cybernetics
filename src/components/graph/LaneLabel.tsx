import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

export type LaneLabelNode = Node<{ name: string }, 'laneLabel'>;

/** Branch edges attach here only to satisfy React Flow; BranchEdge draws the layout's own path. */
export function LaneLabel({ data }: NodeProps<LaneLabelNode>) {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--ink-2)',
        whiteSpace: 'nowrap',
        lineHeight: '16px',
      }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0 }} />
      {data.name}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ opacity: 0 }}
      />
    </div>
  );
}
