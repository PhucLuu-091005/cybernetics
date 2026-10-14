import type { GraphLayout } from '../../contracts/layout';
import type { Viewport } from '../../lib/graph-layout';

// A band thinner than this cannot hold a 12 px name.
const MIN_BAND = 14;

/** Lives outside the React Flow viewport: it follows the vertical pan and the zoom, never the sideways pan. */
export function LaneColumn({ layout, viewport }: { layout: GraphLayout; viewport: Viewport }) {
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
          </span>
        );
      })}
      <span
        className="side"
        style={{ top: viewport.y + layout.trunkY * viewport.zoom - 10, height: 20 }}
      >
        Vendor ↑ Client ↓
      </span>
    </div>
  );
}
