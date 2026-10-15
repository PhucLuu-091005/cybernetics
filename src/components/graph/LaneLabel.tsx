import { Handle, Position, type Node } from '@xyflow/react';

export type LaneLabelNode = Node<{ name: string }, 'laneLabel'>;

/** Branch edges attach here only to satisfy React Flow; LaneColumn shows the names. */
export function LaneLabel() {
  return (
    <div style={{ height: 16 }}>
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0 }} />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ opacity: 0 }}
      />
    </div>
  );
}
