'use client';
import type { PointerEvent } from 'react';
import type { GraphLayout } from '../../contracts/layout';
import {
  minimapScale,
  minimapViewport,
  type Box,
  type Size,
  type Viewport,
} from '../../lib/graph-layout';
import { TONE_COLOR } from './labels';

const MAP: Size = { width: 220, height: 120 };

/** Drawn from the layout, because the React Flow minimap draws only nodes and the branches are edges. */
export function Minimap({
  layout,
  content,
  viewport,
  canvas,
  onMove,
}: {
  layout: GraphLayout;
  content: Box;
  viewport: Viewport;
  canvas: Size;
  onMove(view: Viewport): void;
}) {
  const scale = minimapScale(MAP, content);
  const ox = (MAP.width - (content.x1 - content.x0) * scale) / 2,
    oy = (MAP.height - (content.y1 - content.y0) * scale) / 2;
  const toView = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onMove(
      minimapViewport(
        { x: event.clientX - box.left, y: event.clientY - box.top },
        MAP,
        content,
        canvas,
        viewport.zoom,
      ),
    );
  };
  return (
    <svg
      className="minimap"
      role="img"
      aria-label="Minimap"
      width={MAP.width}
      height={MAP.height}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        toView(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) toView(event);
      }}
    >
      <g
        transform={`translate(${ox - content.x0 * scale} ${oy - content.y0 * scale}) scale(${scale})`}
      >
        {layout.lanes.map((lane) => (
          <rect
            key={lane.id}
            x={content.x0}
            y={lane.y}
            width={content.x1 - content.x0}
            height={lane.height}
            fill={lane.order % 2 ? 'var(--rule-2)' : 'transparent'}
          />
        ))}
        <line
          x1={content.x0}
          y1={layout.trunkY}
          x2={content.x1}
          y2={layout.trunkY}
          stroke="var(--trunk)"
          strokeWidth={6}
        />
        {layout.branches.map((branch) => (
          <line
            key={branch.id}
            x1={branch.xStart}
            y1={branch.y}
            x2={Math.max(branch.xEnd, branch.xStart + 4)}
            y2={branch.y}
            stroke={TONE_COLOR[branch.tone]}
            strokeWidth={8}
          />
        ))}
      </g>
      <rect
        className="view"
        x={ox + (-viewport.x / viewport.zoom - content.x0) * scale}
        y={oy + (-viewport.y / viewport.zoom - content.y0) * scale}
        width={(canvas.width / viewport.zoom) * scale}
        height={(canvas.height / viewport.zoom) * scale}
        rx={3}
      />
    </svg>
  );
}
