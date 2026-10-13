import type { Edge, EdgeProps } from '@xyflow/react';
import type { BranchLayout, BranchSegment } from '../../contracts/layout';
import { TONE_COLOR } from './labels';
import { loopKey, useGraphUi } from './ui-context';

export type BranchEdgeType = Edge<{ branch: BranchLayout; xT: number; left: number }, 'branch'>;

const DASH: Record<BranchSegment['style'], string | undefined> = { solid: undefined, dashed: '7 5', dotted: '1.5 4' };

/** Splits the layout path into its fork curve and optional merge curve, so the row between them can carry per-segment styles. */
function curves(branch: BranchLayout): { fork: string; merge: string | null } {
  const at = branch.path.indexOf(' H');
  const rest = /^ H-?[\d.]+(.*)$/.exec(branch.path.slice(at))?.[1] ?? '';
  return { fork: branch.path.slice(0, at), merge: rest ? `M${branch.xEnd} ${branch.y}${rest}` : null };
}

export function BranchEdge({ data }: EdgeProps<BranchEdgeType>) {
  const ui = useGraphUi();
  if (!data || ui.zoomLevel === 'milestones') return null;
  const { branch, xT, left } = data, { y } = branch, key = loopKey(branch.loopId);
  const { fork, merge } = curves(branch);
  const first = branch.segments[0], last = branch.segments.at(-1)!;
  const selected = ui.selectedLoopId === branch.loopId;
  const width = Math.max(branch.xEnd - branch.xStart, 0);
  return (
    <g transform={`translate(${left} 0)`} className={`${ui.faded.has(branch.loopId) ? 'br-faded' : ''}${selected ? ' br-sel' : ''}`} style={{ transition: 'opacity .15s' }}>
      <path className="line" d={fork} fill="none" stroke={TONE_COLOR[first.tone]} strokeWidth={3} />
      {branch.segments.map((segment, index) => segment.endX > segment.startX && (
        <line key={index} className="line" x1={segment.startX} y1={y} x2={segment.endX} y2={y} stroke={TONE_COLOR[segment.tone]}
          strokeWidth={segment.tone === 'amber' && segment.startX >= xT ? 5 : 3} strokeDasharray={DASH[segment.style]} strokeLinecap={segment.style === 'dotted' || segment.startX >= xT ? 'round' : 'butt'} />
      ))}
      {merge && <path className="line" d={merge} fill="none" stroke={TONE_COLOR[last.tone]} strokeWidth={3} />}
      {branch.endKind === 'cap' && <rect x={branch.xEnd - 1} y={y - 6} width={8} height={12} fill="var(--isolated)" />}
      {branch.breakdownMarkers.map(marker => (
        <g key={`${marker.x}-${marker.label}`} aria-hidden="true">
          <circle cx={marker.x} cy={y} r={7.5} fill="var(--surface)" stroke="var(--danger)" strokeWidth={1.6} />
          <path d={`M${marker.x - 3.4} ${y - 3.4} L${marker.x + 3.4} ${y + 3.4} M${marker.x - 3.4} ${y + 3.4} L${marker.x + 3.4} ${y - 3.4}`} stroke="var(--danger)" strokeWidth={2} />
        </g>
      ))}
      {ui.zoomLevel === 'detail' && <text x={branch.xStart + 8} y={y + 16} fontSize="11" fontWeight="700" fill="var(--ink)">{branch.title}</text>}
      <g className="br" role="button" tabIndex={ui.activeKey === key ? 0 : -1} data-nav-key={key} aria-label={branch.accessibleName} aria-pressed={selected}
        onClick={() => ui.selectLoop(branch.loopId)} onKeyDown={event => ui.navKeyDown(event, key)} onFocus={event => ui.navFocus(event, key)}>
        <rect className="hit" x={branch.xStart - 6} y={y - 7} width={width + 12} height={14} rx={7} />
        {branch.glyphs.map(glyph => (
          <circle key={glyph.id} className="hit-dot" cx={glyph.x} cy={y} r={9}
            onClick={event => { event.stopPropagation(); ui.selectLoop(branch.loopId, glyph.id); }}
            onMouseEnter={event => ui.hoverAct(glyph, event)} onMouseMove={event => ui.hoverAct(glyph, event)} onMouseLeave={() => ui.hoverAct(null)} />
        ))}
      </g>
    </g>
  );
}
