import type { Edge, EdgeProps } from '@xyflow/react';
import type { ActGlyph, BranchLayout, BranchSegment } from '../../contracts/layout';
import { CARD } from '../../lib/graph-layout';
import { TONE_COLOR } from './labels';
import { loopKey, useGraphUi } from './ui-context';

export type BranchEdgeType = Edge<{ branch: BranchLayout; xT: number }, 'branch'>;

const DASH: Record<BranchSegment['style'], string | undefined> = {
  solid: undefined,
  dashed: '7 5',
  dotted: '1.5 4',
};

// The stem leaves the icon above its 18 px glyph and enters the card at least 12 px inside its edge.
const ICON_TOP = 10,
  STEM_INSET = 12,
  STEM_BEND = 10;
function stemPath(glyph: ActGlyph): string | null {
  if (!glyph.card) return null;
  const bottom = glyph.card.y + CARD.height,
    entry = Math.min(
      Math.max(glyph.x, glyph.card.x + STEM_INSET),
      glyph.card.x + CARD.width - STEM_INSET,
    );
  return entry === glyph.x
    ? `M${glyph.x} ${glyph.y - ICON_TOP} V${bottom}`
    : `M${glyph.x} ${glyph.y - ICON_TOP} V${bottom + STEM_BEND} H${entry} V${bottom}`;
}

/** Splits the layout path into its fork curve and optional merge curve, so the row between them can carry per-segment styles. */
function curves(branch: BranchLayout): { fork: string; merge: string | null } {
  const at = branch.path.indexOf(' H');
  const rest = /^ H-?[\d.]+(.*)$/.exec(branch.path.slice(at))?.[1] ?? '';
  return {
    fork: branch.path.slice(0, at),
    merge: rest ? `M${branch.xEnd} ${branch.y}${rest}` : null,
  };
}

export function BranchEdge({ data }: EdgeProps<BranchEdgeType>) {
  const ui = useGraphUi();
  if (!data) return null;
  const { branch, xT } = data,
    { y } = branch,
    key = loopKey(branch.loopId);
  const { fork, merge } = curves(branch);
  const first = branch.segments[0],
    last = branch.segments.at(-1)!;
  const selected = ui.selectedLoopId === branch.loopId;
  const width = Math.max(branch.xEnd - branch.xStart, 0);
  return (
    <g
      className={`${ui.faded.has(branch.loopId) ? 'br-faded' : ''}${selected ? ' br-sel' : ''}`}
      style={{ transition: 'opacity .15s' }}
    >
      {ui.halo.has(branch.loopId) && <path className="halo" d={branch.path} data-testid="halo" />}
      <path className="line" d={fork} fill="none" stroke={TONE_COLOR[first.tone]} strokeWidth={3} />
      {branch.segments.map(
        (segment, index) =>
          segment.endX > segment.startX && (
            <line
              key={index}
              className={segment.tone === 'amber' && segment.startX >= xT ? 'line tail' : 'line'}
              x1={segment.startX}
              y1={y}
              x2={segment.endX}
              y2={y}
              stroke={TONE_COLOR[segment.tone]}
              strokeWidth={segment.tone === 'amber' && segment.startX >= xT ? 5 : 3}
              strokeDasharray={DASH[segment.style]}
              strokeLinecap={segment.style === 'dotted' || segment.startX >= xT ? 'round' : 'butt'}
            />
          ),
      )}
      {merge && (
        <path
          className="line"
          d={merge}
          fill="none"
          stroke={TONE_COLOR[last.tone]}
          strokeWidth={3}
        />
      )}
      {branch.glyphs.map((glyph) => {
        const stem = stemPath(glyph);
        return (
          stem && (
            <path
              key={`stem-${glyph.id}`}
              className="stem"
              d={stem}
              fill="none"
              stroke={
                glyph.type === 'reject'
                  ? 'var(--danger)'
                  : TONE_COLOR[
                      (
                        branch.segments.find(
                          (segment) => segment.startX <= glyph.x && glyph.x <= segment.endX,
                        ) ?? last
                      ).tone
                    ]
              }
            />
          )
        );
      })}
      {branch.endKind === 'cap' && (
        <rect x={branch.xEnd - 1} y={y - 6} width={8} height={12} fill="var(--isolated)" />
      )}
      {branch.breakdownMarkers.map((marker) => (
        <g key={`${marker.x}-${marker.label}`} aria-hidden="true">
          <circle
            cx={marker.x}
            cy={y}
            r={7.5}
            fill="var(--surface)"
            stroke="var(--danger)"
            strokeWidth={1.6}
          />
          <path
            d={`M${marker.x - 3.4} ${y - 3.4} L${marker.x + 3.4} ${y + 3.4} M${marker.x - 3.4} ${y + 3.4} L${marker.x + 3.4} ${y - 3.4}`}
            stroke="var(--danger)"
            strokeWidth={2}
          />
        </g>
      ))}
      <text
        className="br-title"
        x={branch.xStart + 8}
        y={y + 16}
        fontSize="11"
        fontWeight="600"
        fill="var(--ink)"
      >
        {branch.title}
      </text>
      {branch.tasks && (
        <text className="br-tasks" x={branch.xStart + 8} y={y + 30} fontSize="10.5">
          {branch.tasks.count} {branch.tasks.count === 1 ? 'task' : 'tasks'} · {branch.tasks.done}{' '}
          done
        </text>
      )}
      <g
        className="br"
        role="button"
        tabIndex={ui.activeKey === key ? 0 : -1}
        data-nav-key={key}
        aria-label={branch.accessibleName}
        aria-pressed={selected}
        onClick={() => ui.selectLoop(branch.loopId)}
        onDoubleClick={(event) => {
          event.stopPropagation();
          ui.zoomToLoop(branch.loopId);
        }}
        onKeyDown={(event) => ui.navKeyDown(event, key)}
        onFocus={(event) => ui.navFocus(event, key)}
      >
        <rect
          className="hit"
          x={branch.xStart - 6}
          y={y - 7}
          width={width + 12}
          height={14}
          rx={7}
        />
        {branch.glyphs.map((glyph) => (
          <circle
            key={glyph.id}
            className="hit-dot nopan"
            data-act={glyph.id}
            cx={glyph.x}
            cy={y}
            r={11}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => ui.startDrag(event, glyph)}
          >
            <title>{glyph.accessibleName}</title>
          </circle>
        ))}
      </g>
    </g>
  );
}
