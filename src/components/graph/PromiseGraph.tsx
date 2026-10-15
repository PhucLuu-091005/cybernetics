'use client';
import '@xyflow/react/dist/base.css';
import {
  PanOnScrollMode,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useReactFlow,
  useViewport,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import type { MilestoneStatus } from '../../contracts/engine';
import type { GraphContext } from '../../contracts/graph';
import type { ActGlyph, GraphLayout } from '../../contracts/layout';
import {
  BASE_PX_PER_DAY,
  CARD,
  CARD_MIN_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  createTimeScale,
  fitViewport,
  fitWidth,
  lodOf,
  nextZoom,
  zoomAround,
  type Box,
  type LayoutOffsets,
  type Size,
  type TimeScale,
  type Viewport,
} from '../../lib/graph-layout';
import { ActNode, ACT_NODE_SIZE, type ActNodeType } from './ActNode';
import { BranchEdge, type BranchEdgeType } from './BranchEdge';
import { AxisMenu } from './AxisMenu';
import { CanvasControls, type Preset } from './CanvasControls';
import { CardNode, type CardInfo, type CardNodeType } from './CardNode';
import type { DayWidths } from './day-width-store';
import { GATEWAY_SIZE, GatewayNode, type GatewayNodeType } from './GatewayNode';
import { LaneColumn } from './LaneColumn';
import { LaneLabel, type LaneLabelNode } from './LaneLabel';
import { MilestoneNode, MILESTONE_NODE, type MilestoneNodeType } from './MilestoneNode';
import { Minimap } from './Minimap';
import { TimeAxis } from './TimeAxis';
import { TONE_COLOR, shortStamp } from './labels';
import { GraphUiContext, loopKey, milestoneKey, type GraphUi } from './ui-context';

const CURVE = 16,
  PAN_MARGIN = 400,
  // Wide enough that the stripes never end inside the view, even at 10 %.
  STRIPE_OVERHANG = 20_000;
const nodeTypes = {
  act: ActNode,
  card: CardNode,
  gateway: GatewayNode,
  milestone: MilestoneNode,
  laneLabel: LaneLabel,
};
const edgeTypes = { branch: BranchEdge };
type GraphNode = ActNodeType | CardNodeType | GatewayNodeType | MilestoneNodeType | LaneLabelNode;
// A press that moves less than this is a click; a longer one picks its axis once.
const DRAG_START_PX = 4;
const NO_HALO: ReadonlySet<string> = new Set();
const DASH = { solid: undefined, dashed: '7 5', dotted: '1.5 4' } as const;
const NO_PAN = 'pg-no-pan:not(.react-flow__edge)';
const daysFrom = (instant: string, days: number) =>
  new Date(Date.parse(instant) + days * 86_400_000).toISOString();

export type PromiseGraphProps = {
  title: string;
  context: GraphContext;
  layout: GraphLayout;
  T: string;
  milestoneStatus: ReadonlyMap<string, MilestoneStatus>;
  selectedLoopId: string | null;
  selectedMilestoneId: string | null;
  faded: ReadonlySet<string>;
  halo?: ReadonlySet<string>;
  currentActId: string | null;
  /** The element that goes full screen: the canvas and the open panel together. */
  stageRef: RefObject<HTMLDivElement | null>;
  cards: ReadonlyMap<string, CardInfo>;
  offsets: LayoutOffsets;
  /** A drag in progress (`done` false) or finished; `kind` says what moves: one act in its day or the whole branch. */
  onDrag(kind: 'acts' | 'loops', id: string, value: number, done: boolean): void;
  onResetLayout: (() => void) | null;
  /** Day columns the user resized; see the time axis. */
  dayWidths: DayWidths;
  onDayWidth(date: string, width: number | null, done: boolean): void;
  onResetDayWidths: (() => void) | null;
  onSelectLoop(loopId: string, actId?: string): void;
  onSelectMilestone(milestoneId: string): void;
};

function Backdrop({
  layout,
  context,
  T,
  content,
  scale,
}: Pick<PromiseGraphProps, 'layout' | 'context' | 'T'> & { content: Box; scale: TimeScale }) {
  const xT = scale.x(T);
  const days: string[] = [];
  for (let date = context.windowStart; date <= context.windowEnd;) {
    days.push(date);
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }
  const months: string[] = [];
  for (
    let [year, month] = context.windowStart.split('-').map(Number);
    `${year}-${String(month).padStart(2, '0')}-01` <= context.windowEnd;
  ) {
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    if (first > context.windowStart) months.push(first);
    [year, month] = month === 12 ? [year + 1, 1] : [year, month + 1];
  }
  const x0 = content.x0 - STRIPE_OVERHANG,
    width = content.x1 - content.x0 + STRIPE_OVERHANG * 2;
  return (
    <svg
      width={1}
      height={1}
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
      {layout.lanes.map((lane) => (
        <rect
          key={lane.id}
          x={x0}
          y={lane.y}
          width={width}
          height={lane.height}
          fill={lane.order % 2 ? 'var(--stripe)' : 'transparent'}
        />
      ))}
      {days.map((date) => (
        <line
          key={date}
          className="day-line"
          x1={scale.dateStartX(date)}
          y1={0}
          x2={scale.dateStartX(date)}
          y2={layout.height}
        />
      ))}
      {[context.windowStart, ...months, context.windowEnd].map((date, index, all) => {
        const end = index === all.length - 1,
          x = end ? scale.dateEndX(date) : scale.dateStartX(date);
        return (
          <line
            key={`${date}-${index}`}
            x1={x}
            y1={0}
            x2={x}
            y2={layout.height}
            stroke="var(--rule-2)"
            strokeDasharray={index === 0 || end ? '2 4' : undefined}
          />
        );
      })}
      {layout.connectors.map((connector) => (
        <g key={connector.id} className="handoff">
          <path
            d={connector.path}
            fill="none"
            stroke={TONE_COLOR[connector.tone]}
            strokeWidth={2.4}
            strokeDasharray={DASH[connector.style]}
            strokeLinecap="round"
          />
          {connector.note && (
            <text
              x={connector.note.x}
              y={connector.note.y}
              className="handoff-note"
              textAnchor="middle"
            >
              {connector.note.text}
            </text>
          )}
        </g>
      ))}
      <line
        x1={-CURVE}
        y1={layout.trunkY}
        x2={layout.width}
        y2={layout.trunkY}
        stroke="var(--trunk)"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <line
        x1={xT}
        y1={0}
        x2={xT}
        y2={layout.height}
        stroke="var(--ink)"
        strokeWidth={1.2}
        strokeDasharray="4 3"
      />
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
    </svg>
  );
}

function Graph(props: PromiseGraphProps) {
  const {
    layout,
    context,
    T,
    milestoneStatus,
    selectedLoopId,
    selectedMilestoneId,
    faded,
    halo = NO_HALO,
    currentActId,
    stageRef,
    cards,
    offsets,
    onDrag,
    onResetLayout,
    dayWidths,
    onDayWidth,
    onResetDayWidths,
    onSelectLoop,
    onSelectMilestone,
  } = props;
  const flow = useReactFlow<GraphNode, BranchEdgeType>();
  const viewport = useViewport();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [minimap, setMinimap] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenEnabled, setFullscreenEnabled] = useState(false);
  const content: Box = useMemo(
    () => ({ x0: -CURVE, x1: layout.width + CURVE, y0: 0, y1: layout.height }),
    [layout],
  );
  const scale = useMemo(
    () => createTimeScale(context, BASE_PX_PER_DAY, dayWidths),
    [context, dayWidths],
  );
  const xT = useMemo(() => scale.x(T), [scale, T]);
  // Read at call time, so the handlers below never change with the size and never rebuild every node.
  const sizeNow = useCallback((): Size => {
    const box = wrapRef.current?.getBoundingClientRect();
    return { width: box?.width ?? 0, height: box?.height ?? 0 };
  }, []);

  // A mouse press on an event card or icon drags it, not the canvas. Touches still reach the canvas, so a pinch over any element zooms.
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const keep = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('.hit-dot, .ev-card'))
        event.stopPropagation();
    };
    element.addEventListener('mousedown', keep, { capture: true });
    return () => element.removeEventListener('mousedown', keep, { capture: true });
  }, []);
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // SRD 7.2 (14 Oct 2026): the first view is 100 % with T at 80 % of the width and the trunk at the centre.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || size.width === 0) return;
    placed.current = true;
    void flow.setViewport({
      x: size.width * 0.8 - xT,
      y: size.height / 2 - layout.trunkY,
      zoom: 1,
    });
  }, [size, flow, xT, layout.trunkY]);

  useEffect(() => {
    // iPhone Safari has no element full screen; the button then stays hidden.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFullscreenEnabled(document.fullscreenEnabled === true);
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [stageRef]);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen().catch(() => undefined);
  }, [stageRef]);

  const applyPreset = useCallback(
    (preset: Preset) => {
      const canvas = sizeNow(),
        current = flow.getViewport();
      const view =
        preset === 'project'
          ? fitViewport(content, canvas)
          : preset === 'week'
            ? fitWidth(scale.x(daysFrom(T, -4)), scale.x(daysFrom(T, 3)), layout.trunkY, canvas)
            : preset === 'month'
              ? fitWidth(scale.x(daysFrom(T, -25)), scale.x(daysFrom(T, 5)), layout.trunkY, canvas)
              : zoomAround(current, preset, { x: canvas.width / 2, y: canvas.height / 2 });
      void flow.setViewport(view, { duration: 200 });
    },
    [sizeNow, flow, content, scale, T, layout.trunkY],
  );
  // A second press during the 150 ms animation steps from the target, not from a zoom halfway there.
  const target = useRef<{ view: Viewport; until: number } | null>(null);
  const step = useCallback(
    (direction: 1 | -1) => {
      const canvas = sizeNow(),
        current =
          target.current && target.current.until > performance.now()
            ? target.current.view
            : flow.getViewport();
      const view = zoomAround(current, nextZoom(current.zoom, direction), {
        x: canvas.width / 2,
        y: canvas.height / 2,
      });
      target.current = { view, until: performance.now() + 150 };
      void flow.setViewport(view, { duration: 150 });
    },
    [sizeNow, flow],
  );
  // Zoom to a loop stops at 150 %, so its text stays a normal reading size.
  const zoomToLoop = useCallback(
    (loopId: string) => {
      const branch = layout.branches.find((item) => item.loopId === loopId);
      if (!branch) return;
      const cards = branch.glyphs.flatMap((glyph) => (glyph.card ? [glyph.card] : []));
      const box = {
        x0: Math.min(branch.xStart - CURVE, ...cards.map((card) => card.x)),
        x1: Math.max(branch.xEnd + CURVE, ...cards.map((card) => card.x + CARD.width)),
        y0: Math.min(branch.y - 30, ...cards.map((card) => card.y)),
        y1: branch.y + 30,
      };
      void flow.setViewport(fitViewport(box, sizeNow(), 48, 1.5), { duration: 200 });
    },
    [layout, sizeNow, flow],
  );

  const order = useMemo(
    () => [
      ...layout.navigation.milestoneIds.map(milestoneKey),
      ...layout.navigation.loopIds.map(loopKey),
    ],
    [layout],
  );
  const tabStop = activeKey !== null && order.includes(activeKey) ? activeKey : (order[0] ?? null);
  const pointOfKey = useCallback(
    (key: string): { x: number; y: number } | undefined => {
      if (key.startsWith('m:')) {
        const item = layout.milestones.find((milestone) => milestoneKey(milestone.id) === key);
        return item && { x: item.x, y: item.y };
      }
      const branch = layout.branches.find((item) => loopKey(item.loopId) === key);
      return branch && { x: branch.xStart, y: branch.y };
    },
    [layout],
  );
  // Moves the canvas only when the item is outside the visible area, so a click on a visible item never shifts it.
  const reveal = useCallback(
    (key: string) => {
      const point = pointOfKey(key),
        area = wrapRef.current?.getBoundingClientRect();
      const item = wrapRef.current
        ?.querySelector(`[data-nav-key="${key}"]`)
        ?.getBoundingClientRect();
      if (!point || !area || !item) return;
      const inside =
        item.right > area.left + 24 &&
        item.left < area.right - 24 &&
        item.bottom > area.top + 12 &&
        item.top < area.bottom - 12;
      if (inside) return;
      const current = flow.getViewport();
      void flow.setViewport({
        zoom: current.zoom,
        x: area.width * 0.3 - point.x * current.zoom,
        y: area.height / 2 - point.y * current.zoom,
      });
    },
    [pointOfKey, flow],
  );
  useEffect(() => {
    if (selectedLoopId && size.width > 0) reveal(loopKey(selectedLoopId));
  }, [selectedLoopId, size.width, reveal]);

  // Read at press time through a ref, so a drag never rebuilds the context that every node reads.
  const offsetsRef = useRef(offsets);
  useEffect(() => {
    offsetsRef.current = offsets;
  }, [offsets]);
  const startDrag = useCallback(
    (event: PointerEvent, glyph: ActGlyph) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      // On touch the canvas owns movement (pan and pinch); a tap still opens the loop.
      const touch = event.pointerType === 'touch';
      const zoom = flow.getViewport().zoom,
        x0 = event.clientX,
        y0 = event.clientY,
        dayWidth = glyph.dayEndX - glyph.dayStartX,
        fraction0 = (glyph.x - glyph.dayStartX) / dayWidth,
        shift0 = offsetsRef.current.loops[glyph.loopId] ?? 0;
      let axis: 'x' | 'y' | null = null,
        last = 0;
      const valueAt = (moveEvent: globalThis.PointerEvent) =>
        axis === 'x'
          ? Math.min(1, Math.max(0, fraction0 + (moveEvent.clientX - x0) / zoom / dayWidth))
          : shift0 + (moveEvent.clientY - y0) / zoom;
      const onMove = (moveEvent: globalThis.PointerEvent) => {
        if (touch) {
          if (Math.hypot(moveEvent.clientX - x0, moveEvent.clientY - y0) >= DRAG_START_PX)
            axis = 'x';
          return;
        }
        if (!axis) {
          const dx = moveEvent.clientX - x0,
            dy = moveEvent.clientY - y0;
          if (Math.hypot(dx, dy) < DRAG_START_PX) return;
          axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        }
        last = valueAt(moveEvent);
        onDrag(
          axis === 'x' ? 'acts' : 'loops',
          axis === 'x' ? glyph.id : glyph.loopId,
          last,
          false,
        );
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (!axis) {
          onSelectLoop(glyph.loopId, glyph.id);
          return;
        }
        if (touch) return;
        onDrag(axis === 'x' ? 'acts' : 'loops', axis === 'x' ? glyph.id : glyph.loopId, last, true);
        // The browser still sends a click to the common ancestor; it must not open the loop.
        const swallow = (clickEvent: MouseEvent) => clickEvent.stopPropagation();
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [flow, onDrag, onSelectLoop],
  );

  const ui: GraphUi = useMemo(
    () => ({
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
      startDrag,
      zoomToLoop,
    }),
    [
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
      startDrag,
      zoomToLoop,
    ],
  );

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
      position: { x: 0, y: lane.y + lane.height / 2 - 8 },
      width: 1,
      height: 16,
      data: { name: lane.name },
      handles: [
        { type: 'source', position: Position.Right, x: 1, y: 8, width: 1, height: 1 },
        { type: 'target', position: Position.Left, x: 0, y: 8, width: 1, height: 1 },
      ],
    }));
    const milestones: MilestoneNodeType[] = layout.milestones.map((milestone, index) => ({
      ...fixed,
      id: `milestone:${milestone.id}`,
      type: 'milestone',
      position: {
        x: milestone.x - MILESTONE_NODE.width / 2,
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
          position: { x: glyph.x - ACT_NODE_SIZE / 2, y: glyph.y - ACT_NODE_SIZE / 2 },
          width: ACT_NODE_SIZE,
          height: ACT_NODE_SIZE,
          data: { glyph, color: TONE_COLOR[segment.tone] },
        };
      }),
    );
    const cardNodes: CardNodeType[] = layout.branches.flatMap((branch) =>
      branch.glyphs.flatMap((glyph) => {
        const info = cards.get(glyph.id);
        if (!glyph.card || !info) return [];
        const segment =
          branch.segments.find((item) => item.startX <= glyph.x && glyph.x <= item.endX) ??
          branch.segments.at(-1)!;
        return [
          {
            ...fixed,
            id: `card:${glyph.id}`,
            type: 'card' as const,
            style: { pointerEvents: 'all' as const },
            position: { x: glyph.card.x, y: glyph.card.y },
            width: CARD.width,
            height: CARD.height,
            data: {
              glyph,
              info,
              color: glyph.type === 'reject' ? 'var(--danger)' : TONE_COLOR[segment.tone],
            },
          },
        ];
      }),
    );
    const gateways: GatewayNodeType[] = layout.gateways.map((gateway) => ({
      ...fixed,
      id: `gateway:${gateway.id}`,
      type: 'gateway' as const,
      position: { x: gateway.x - GATEWAY_SIZE / 2, y: gateway.y - GATEWAY_SIZE / 2 },
      width: GATEWAY_SIZE,
      height: GATEWAY_SIZE,
      style: { pointerEvents: 'all' as const },
      data: { gateway },
    }));
    return [...lanes, ...milestones, ...acts, ...gateways, ...cardNodes];
  }, [layout, milestoneStatus, cards]);
  const edges = useMemo<BranchEdgeType[]>(
    () =>
      layout.branches.map((branch) => ({
        id: `branch:${branch.loopId}`,
        type: 'branch',
        source: `lane:${branch.departmentId}`,
        target: `lane:${branch.departmentId}`,
        data: { branch, xT },
        selectable: false,
        focusable: false,
        ariaRole: 'group',
        domAttributes: { 'aria-roledescription': undefined },
        // React Flow treats null as "no label" at runtime (EdgeWrapper); its types omit null. The inner button carries the name.
        ariaLabel: null as unknown as undefined,
      })),
    [layout, xT],
  );

  const lod = lodOf(viewport.zoom);
  return (
    <GraphUiContext.Provider value={ui}>
      <div
        className={`canvas-stage lod-${lod}${viewport.zoom < CARD_MIN_ZOOM ? ' cards-off' : ''}`}
      >
        <div className="canvas-corner">
          <AxisMenu onResetWidths={onResetDayWidths} />
        </div>
        <div className="canvas-axis">
          <TimeAxis
            context={context}
            scale={scale}
            onResize={onDayWidth}
            T={T}
            tLabel={shortStamp(T, context.timeZone)}
            viewport={viewport}
            width={size.width}
          />
        </div>
        <LaneColumn layout={layout} viewport={viewport} />
        <div
          ref={wrapRef}
          className="gwrap"
          role="group"
          aria-label={`Promise graph for ${props.title}`}
          data-zoom={viewport.zoom.toFixed(2)}
          data-ready={size.width > 0 ? 'true' : undefined}
        >
          <ReactFlow<GraphNode, BranchEdgeType>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            translateExtent={[
              [content.x0 - PAN_MARGIN, content.y0 - PAN_MARGIN],
              [content.x1 + PAN_MARGIN, content.y1 + PAN_MARGIN],
            ]}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            disableKeyboardA11y
            panOnDrag
            panOnScroll
            panOnScrollMode={PanOnScrollMode.Free}
            zoomOnScroll={false}
            zoomOnPinch
            zoomActivationKeyCode={['Meta', 'Control']}
            zoomOnDoubleClick={false}
            // React Flow adds this class to every edge and tests it with `closest('.' + name)`. The `:not` makes
            // that test never match, so a touch pan or pinch over a branch works; the mousedown capture above
            // still keeps mouse drags on cards and icons.
            noPanClassName={NO_PAN}
            preventScrolling
            proOptions={{ hideAttribution: true }}
          >
            <ViewportPortal>
              <Backdrop layout={layout} context={context} T={T} content={content} scale={scale} />
            </ViewportPortal>
          </ReactFlow>
        </div>
        {minimap && size.width > 0 && (
          <Minimap
            layout={layout}
            content={content}
            viewport={viewport}
            canvas={size}
            onMove={(view) => void flow.setViewport(view)}
          />
        )}
        <CanvasControls
          zoom={viewport.zoom}
          onStep={step}
          onPreset={applyPreset}
          minimap={minimap}
          onMinimap={() => setMinimap((value) => !value)}
          fullscreen={fullscreen}
          fullscreenEnabled={fullscreenEnabled}
          onFullscreen={toggleFullscreen}
          onResetLayout={onResetLayout}
        />
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
