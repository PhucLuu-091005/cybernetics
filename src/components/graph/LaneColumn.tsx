import type { PointerEvent } from 'react';
import type { GraphLayout } from '../../contracts/layout';
import type { LaneScale, Viewport } from '../../lib/graph-layout';

// A band thinner than this cannot hold a 12 px name.
const MIN_BAND = 14;
export const LANE_SCALE = { min: 0.3, max: 8 } as const;

/** Lives outside the React Flow viewport: it follows the vertical pan and the zoom, never the sideways pan. */
export function LaneColumn({
  layout,
  viewport,
  laneScale,
  onResizeLane,
}: {
  layout: GraphLayout;
  viewport: Viewport;
  laneScale: LaneScale;
  /** A new stretch for one lane; `null` returns it to its natural height. */
  onResizeLane(departmentId: string, scale: number | null, done: boolean): void;
}) {
  const startResize = (event: PointerEvent<HTMLElement>, departmentId: string, height: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const grip = event.currentTarget,
      y0 = event.clientY,
      scale0 = laneScale[departmentId] ?? 1,
      natural = height / scale0;
    grip.setPointerCapture(event.pointerId);
    const scaleAt = (clientY: number) =>
      Math.min(LANE_SCALE.max, Math.max(LANE_SCALE.min, (height + clientY - y0) / natural));
    const onMove = (move: globalThis.PointerEvent) =>
      onResizeLane(departmentId, scaleAt(move.clientY), false);
    const onUp = (up: globalThis.PointerEvent) => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      onResizeLane(departmentId, scaleAt(up.clientY), true);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  };
  return (
    <div className="lane-col" data-testid="lane-column">
      {layout.lanes.map((lane) => {
        const height = lane.height * viewport.zoom;
        return (
          <span
            key={lane.id}
            data-lane={lane.departmentId}
            className={lane.order % 2 ? 'odd' : undefined}
            style={{ top: viewport.y + lane.y * viewport.zoom, height }}
            title={lane.name}
          >
            {height >= MIN_BAND ? lane.name : ''}
            <i
              className="lane-grip"
              role="separator"
              aria-orientation="horizontal"
              aria-label={`${lane.name} row height`}
              title="Drag to change the row height. Double-click to reset it."
              onPointerDown={(event) => startResize(event, lane.departmentId, height)}
              onDoubleClick={() => onResizeLane(lane.departmentId, null, true)}
            />
          </span>
        );
      })}
      <span
        className="side"
        style={{ top: viewport.y + layout.trunkY * viewport.zoom - 10, height: 20 }}
      >
        Milestones
      </span>
    </div>
  );
}
