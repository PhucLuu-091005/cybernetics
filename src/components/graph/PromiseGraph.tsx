'use client';
import '@xyflow/react/dist/base.css';
import {
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  type Viewport,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { MilestoneStatus } from '../../contracts/engine';
import type { GraphContext } from '../../contracts/graph';
import type { ActGlyph, GraphLayout } from '../../contracts/layout';
import { createTimeScale } from '../../lib/graph-layout';
import { ActNode, ACT_NODE_SIZE, type ActNodeType } from './ActNode';
import { BranchEdge, type BranchEdgeType } from './BranchEdge';
import { LaneLabel, type LaneLabelNode } from './LaneLabel';
import { MilestoneNode, MILESTONE_NODE, type MilestoneNodeType } from './MilestoneNode';
import { TONE_COLOR, shortStamp } from './labels';
import { GraphUiContext, loopKey, milestoneKey, type GraphUi } from './ui-context';

// Gutters from the approved design: lane names sit left of the time axis.
export const GRAPH_LEFT = 128;
export const GRAPH_RIGHT = 36;
const AXIS_LABEL_Y = 18;
const nodeTypes = { act: ActNode, milestone: MilestoneNode, laneLabel: LaneLabel };
const edgeTypes = { branch: BranchEdge };
type GraphNode = ActNodeType | MilestoneNodeType | LaneLabelNode;
const NO_HALO: ReadonlySet<string> = new Set();

export type PromiseGraphProps = {
  title: string;
  clientName: string;
  context: GraphContext;
  layout: GraphLayout;
  pxPerDay: number;
  T: string;
  milestoneStatus: ReadonlyMap<string, MilestoneStatus>;
  selectedLoopId: string | null;
  selectedMilestoneId: string | null;
  faded: ReadonlySet<string>;
  halo?: ReadonlySet<string>;
  currentActId: string | null;
  revealX: number | null;
  onSelectLoop(loopId: string, actId?: string): void;
  onSelectMilestone(milestoneId: string): void;
  onHoverAct(glyph: ActGlyph | null, event?: MouseEvent): void;
  onWidth(width: number): void;
  onZoom(pxPerDay: number): void;
};

function Backdrop({
  layout,
  context,
  T,
  clientName,
  contentWidth,
  pxPerDay,
}: Pick<PromiseGraphProps, 'layout' | 'context' | 'T' | 'clientName' | 'pxPerDay'> & {
  contentWidth: number;
}) {
  const scale = createTimeScale(context, pxPerDay);
  const xT = GRAPH_LEFT + scale.x(T);
  const months: string[] = [];
  for (
    let [year, month] = context.windowStart.split('-').map(Number);
    `${year}-${String(month).padStart(2, '0')}-01` <= context.windowEnd;
  ) {
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    if (first > context.windowStart) months.push(first);
    [year, month] = month === 12 ? [year + 1, 1] : [year, month + 1];
  }
  const dayStart = (date: string) => GRAPH_LEFT + scale.dateEndX(date) - pxPerDay;
  const monthLabel = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  return (
    <svg
      width={contentWidth}
      height={layout.height}
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        zIndex: -1,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <defs>
        <marker id="slip-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill="var(--trunk)" />
        </marker>
      </defs>
      <rect width={contentWidth} height={layout.height} fill="var(--surface)" />
      {layout.lanes.map((lane) => (
        <rect
          key={lane.id}
          x={0}
          y={lane.y}
          width={contentWidth}
          height={lane.height}
          fill={lane.order % 2 ? 'var(--panel)' : 'transparent'}
          opacity={0.55}
        />
      ))}
      <text x={12} y={AXIS_LABEL_Y} fontSize="11" fontWeight="700" fill="var(--ink-3)">
        Vendor
      </text>
      <text x={12} y={layout.height - 14} fontSize="11" fontWeight="700" fill="var(--ink-3)">
        Client, {clientName}
      </text>
      <line
        x1={GRAPH_LEFT - 8}
        y1={0}
        x2={GRAPH_LEFT - 8}
        y2={layout.height}
        stroke="var(--rule)"
      />
      {[context.windowStart, ...months, context.windowEnd].map((date, index, all) => {
        const edge = index === 0 || index === all.length - 1,
          x = edge && index > 0 ? GRAPH_LEFT + scale.dateEndX(date) : dayStart(date);
        return (
          <g key={`${date}-${index}`}>
            <line
              x1={x}
              y1={AXIS_LABEL_Y + 4}
              x2={x}
              y2={layout.height}
              stroke="var(--rule-2)"
              strokeDasharray={edge ? '2 4' : undefined}
            />
            {!edge && (
              <text x={x + 4} y={AXIS_LABEL_Y} fontSize="11" fill="var(--ink-3)">
                {monthLabel(date)}
              </text>
            )}
          </g>
        );
      })}
      <line
        x1={GRAPH_LEFT - 4}
        y1={layout.trunkY}
        x2={GRAPH_LEFT + layout.width - 12}
        y2={layout.trunkY}
        stroke="var(--trunk)"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <line
        x1={xT}
        y1={AXIS_LABEL_Y + 4}
        x2={xT}
        y2={layout.height}
        stroke="var(--ink)"
        strokeWidth={1.2}
        strokeDasharray="4 3"
      />
      <rect x={xT - 40} y={2} width={80} height={16} rx={3} fill="var(--ink)" />
      <text x={xT} y={14} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--surface)">
        T {shortStamp(T, context.timeZone)}
      </text>
      <g transform={`translate(${GRAPH_LEFT} 0)`}>
        {layout.milestones
          .filter((item) => item.ghostX !== null)
          .map((item) => (
            <g key={item.id}>
              <polygon
                points={`${item.ghostX},${item.y - 8} ${item.ghostX! + 8},${item.y} ${item.ghostX},${item.y + 8} ${item.ghostX! - 8},${item.y}`}
                fill="var(--surface)"
                stroke="var(--trunk)"
                strokeWidth={1.6}
                strokeDasharray="2 2"
              />
              {item.slipPath && (
                <path
                  d={item.slipPath}
                  fill="none"
                  stroke="var(--trunk)"
                  strokeWidth={1.4}
                  strokeDasharray="4 3"
                  markerEnd="url(#slip-arrow)"
                />
              )}
            </g>
          ))}
      </g>
    </svg>
  );
}

function Graph(props: PromiseGraphProps) {
  const {
    layout,
    context,
    T,
    pxPerDay,
    milestoneStatus,
    onWidth,
    onZoom,
    revealX,
    selectedLoopId,
    selectedMilestoneId,
    faded,
    halo = NO_HALO,
    currentActId,
    onSelectLoop,
    onSelectMilestone,
    onHoverAct,
  } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [x, setX] = useState(0);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const pendingX = useRef<number | null>(null);
  const contentWidth = GRAPH_LEFT + layout.width + GRAPH_RIGHT;
  const clampX = useCallback(
    (value: number) => Math.min(0, Math.max(Math.min(0, width - contentWidth), value)),
    [width, contentWidth],
  );

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
      onWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onWidth]);
  // A wheel zoom keeps the instant under the pointer in place, a zoom button the instant at the centre; every resize or relayout re-clamps the pan.
  const lastPx = useRef<number | null>(null);
  useEffect(() => {
    const previousPx = lastPx.current,
      pending = pendingX.current,
      centre = width / 2;
    lastPx.current = pxPerDay;
    pendingX.current = null;
    const anchored = (current: number) =>
      previousPx === null || previousPx === pxPerDay
        ? current
        : centre - GRAPH_LEFT - ((centre - current - GRAPH_LEFT) / previousPx) * pxPerDay;
    setX((current) => clampX(pending ?? anchored(current)));
  }, [clampX, layout, pxPerDay, width]);
  useEffect(() => {
    if (revealX === null || width === 0) return;
    const target = GRAPH_LEFT + revealX;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setX((previous) =>
      target + previous < 0 || target + previous > width - 40
        ? clampX(width * 0.25 - target)
        : previous,
    );
  }, [revealX, width, clampX]);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
        setX((previous) => clampX(previous - (event.deltaX || event.deltaY)));
        return;
      }
      const next = Math.min(120, Math.max(2, pxPerDay * Math.exp(-event.deltaY * 0.002)));
      const pointer = event.clientX - element.getBoundingClientRect().left;
      const day = (pointer - x - GRAPH_LEFT) / pxPerDay;
      pendingX.current = pointer - GRAPH_LEFT - day * next;
      onZoom(next);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [pxPerDay, x, clampX, onZoom]);
  // Two-finger pinch scales pxPerDay around the midpoint, like the wheel around the pointer (SRD 7.2).
  const pinch = useRef<{ distance: number; pxPerDay: number; day: number } | null>(null);
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const measure = (event: TouchEvent) => {
      const [a, b] = [event.touches[0], event.touches[1]],
        left = element.getBoundingClientRect().left;
      return {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        mid: (a.clientX + b.clientX) / 2 - left,
      };
    };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      const { distance, mid } = measure(event);
      pinch.current = { distance, pxPerDay, day: (mid - x - GRAPH_LEFT) / pxPerDay };
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !pinch.current) return;
      event.preventDefault();
      const { distance, mid } = measure(event),
        start = pinch.current;
      const next = Math.min(
        120,
        Math.max(2, (start.pxPerDay * distance) / Math.max(1, start.distance)),
      );
      pendingX.current = mid - GRAPH_LEFT - start.day * next;
      onZoom(next);
    };
    const onEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch.current = null;
    };
    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchmove', onMove, { passive: false });
    element.addEventListener('touchend', onEnd);
    element.addEventListener('touchcancel', onEnd);
    return () => {
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onEnd);
    };
  }, [pxPerDay, x, onZoom]);

  const order = useMemo(
    () => [
      ...layout.navigation.milestoneIds.map(milestoneKey),
      ...(layout.zoomLevel === 'milestones' ? [] : layout.navigation.loopIds.map(loopKey)),
    ],
    [layout],
  );
  const tabStop = activeKey !== null && order.includes(activeKey) ? activeKey : (order[0] ?? null);
  const xOfKey = useCallback(
    (key: string) =>
      key.startsWith('m:')
        ? layout.milestones.find((item) => milestoneKey(item.id) === key)?.x
        : layout.branches.find((item) => loopKey(item.loopId) === key)?.xStart,
    [layout],
  );
  const reveal = useCallback(
    (key: string) => {
      const at = xOfKey(key);
      if (at === undefined) return;
      setX((previous) =>
        GRAPH_LEFT + at + previous < 0 || GRAPH_LEFT + at + previous > width - 40
          ? clampX(width * 0.25 - GRAPH_LEFT - at)
          : previous,
      );
    },
    [xOfKey, width, clampX],
  );

  const ui: GraphUi = useMemo(
    () => ({
      zoomLevel: layout.zoomLevel,
      selectedLoopId,
      selectedMilestoneId,
      faded,
      halo,
      currentActId,
      activeKey: tabStop,
      navFocus: (_event: FocusEvent, key: string) => {
        setActiveKey(key);
        reveal(key);
      },
      // SRD 7.3: Tab walks milestones in time order, then branches in start order; leaving either end returns Tab to the page.
      navKeyDown: (event: KeyboardEvent, key: string) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (key.startsWith('m:')) onSelectMilestone(key.slice(2));
          else onSelectLoop(key.slice(2));
          return;
        }
        if (event.key !== 'Tab') return;
        const next = order[order.indexOf(key) + (event.shiftKey ? -1 : 1)];
        if (!next) return;
        event.preventDefault();
        setActiveKey(next);
        reveal(next);
        wrapRef.current
          ?.querySelector<SVGElement>(`[data-nav-key="${next}"]`)
          ?.focus({ preventScroll: true });
      },
      selectLoop: onSelectLoop,
      selectMilestone: onSelectMilestone,
      hoverAct: onHoverAct,
    }),
    [
      layout.zoomLevel,
      selectedLoopId,
      selectedMilestoneId,
      faded,
      halo,
      currentActId,
      tabStop,
      order,
      reveal,
      onSelectLoop,
      onSelectMilestone,
      onHoverAct,
    ],
  );

  const xT = useMemo(() => createTimeScale(context, pxPerDay).x(T), [context, pxPerDay, T]);
  const nodes = useMemo<GraphNode[]>(() => {
    const fixed = {
      draggable: false,
      selectable: false,
      focusable: false,
      connectable: false,
      style: { pointerEvents: 'none' as const },
      domAttributes: { 'aria-roledescription': undefined },
    };
    const lanes: LaneLabelNode[] = layout.lanes.map((lane) => ({
      ...fixed,
      id: `lane:${lane.departmentId}`,
      type: 'laneLabel',
      position: { x: 12, y: lane.y + lane.height / 2 - 8 },
      width: GRAPH_LEFT - 24,
      height: 16,
      data: { name: lane.name },
      handles: [
        { type: 'source', position: Position.Right, x: GRAPH_LEFT - 24, y: 8, width: 1, height: 1 },
        { type: 'target', position: Position.Left, x: 0, y: 8, width: 1, height: 1 },
      ],
    }));
    const milestones: MilestoneNodeType[] = layout.milestones.map((milestone, index) => ({
      ...fixed,
      id: `milestone:${milestone.id}`,
      type: 'milestone',
      position: {
        x: GRAPH_LEFT + milestone.x - MILESTONE_NODE.width / 2,
        y: milestone.y - MILESTONE_NODE.height / 2,
      },
      ...MILESTONE_NODE,
      data: { milestone, status: milestoneStatus.get(milestone.id) ?? 'on_track', index },
    }));
    const acts: ActNodeType[] = layout.branches.flatMap((branch) =>
      branch.glyphs.map((glyph) => {
        const segment =
          branch.segments.find((item) => item.startX <= glyph.x && glyph.x <= item.endX) ??
          branch.segments.at(-1)!;
        return {
          ...fixed,
          id: `act:${glyph.id}`,
          type: 'act' as const,
          position: { x: GRAPH_LEFT + glyph.x - ACT_NODE_SIZE / 2, y: glyph.y - ACT_NODE_SIZE / 2 },
          width: ACT_NODE_SIZE,
          height: ACT_NODE_SIZE,
          hidden: layout.zoomLevel === 'milestones',
          data: { glyph, color: TONE_COLOR[segment.tone] },
        };
      }),
    );
    return [...lanes, ...milestones, ...acts];
  }, [layout, milestoneStatus]);
  const edges = useMemo<BranchEdgeType[]>(
    () =>
      layout.branches.map((branch) => ({
        id: `branch:${branch.loopId}`,
        type: 'branch',
        source: `lane:${branch.departmentId}`,
        target: `lane:${branch.departmentId}`,
        data: { branch, xT, left: GRAPH_LEFT },
        selectable: false,
        focusable: false,
        ariaRole: 'group',
        domAttributes: { 'aria-roledescription': undefined },
        // React Flow treats null as "no label" at runtime (EdgeWrapper); its types omit null. The inner button carries the name.
        ariaLabel: null as unknown as undefined,
      })),
    [layout, xT],
  );

  const viewport: Viewport = { x, y: 0, zoom: 1 };
  return (
    <GraphUiContext.Provider value={ui}>
      <div
        ref={wrapRef}
        className="gwrap"
        role="group"
        aria-label={`Promise graph for ${props.title}`}
        data-px-per-day={pxPerDay.toFixed(2)}
        data-ready={width > 0 ? 'true' : undefined}
        style={{ height: layout.height + 2, touchAction: 'pan-y' }}
      >
        <ReactFlow<GraphNode, BranchEdgeType>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          viewport={viewport}
          onViewportChange={(next) => setX(clampX(next.x))}
          minZoom={1}
          maxZoom={1}
          translateExtent={[
            [0, 0],
            [Math.max(contentWidth, width), layout.height],
          ]}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          disableKeyboardA11y
          panOnDrag
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          panOnScroll={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
        >
          <ViewportPortal>
            <Backdrop
              layout={layout}
              context={context}
              T={T}
              clientName={props.clientName}
              contentWidth={contentWidth}
              pxPerDay={pxPerDay}
            />
          </ViewportPortal>
        </ReactFlow>
      </div>
    </GraphUiContext.Provider>
  );
}

export function PromiseGraph(props: PromiseGraphProps) {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}
