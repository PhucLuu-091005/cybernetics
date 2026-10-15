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
  CARD,
  CARD_MIN_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  fitViewport,
  fitWidth,
  lodOf,
  nextZoom,
  zoomAround,
  type Box,
  type LayoutOffsets,
  type Size,
  type Viewport,
} from '../../lib/graph-layout';
import { ActNode, ACT_NODE_SIZE, type ActNodeType } from './ActNode';
import { BranchEdge, type BranchEdgeType } from './BranchEdge';
import { AxisMenu } from './AxisMenu';
import { CanvasControls, type Preset } from './CanvasControls';
import { CardNode, type CardInfo, type CardNodeType } from './CardNode';
import { GATEWAY_SIZE, GatewayNode, type GatewayNodeType } from './GatewayNode';
import { LaneColumn } from './LaneColumn';
import { LaneLabel, type LaneLabelNode } from './LaneLabel';
import { LoopIndex, type IndexEntry } from './LoopIndex';
import { MilestoneNode, MILESTONE_NODE, type MilestoneNodeType } from './MilestoneNode';
import { Minimap } from './Minimap';
import { TimeAxis } from './TimeAxis';
import { TONE_COLOR, shortStamp } from './labels';
import {
  GraphUiContext,
  loopKey,
  milestoneKey,
  type DragChange,
  type DragTarget,
  type GraphUi,
} from './ui-context';

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
// Zoom to a loop stops between 60 % (titles readable) and 150 % (text at a normal reading size).
const JUMP_MIN_ZOOM = 0.6,
  JUMP_PADDING = 48;
const LIST_KEY = 'promise-graph:loop-list',
  // Below this screen width the list starts closed, so the canvas keeps its room.
  LIST_MIN_SCREEN = 1100;

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
  onDrag(change: DragChange, done: boolean): void;
  onResetLayout: (() => void) | null;
  /** Day columns the user resized; see the time axis. */
  onDayWidth(date: string, width: number | null, done: boolean): void;
  onResetDayWidths: (() => void) | null;
  /** The loop list on the right of the canvas. */
  index: {
    entries: readonly IndexEntry[];
    only: ReadonlySet<string>;
    onToggleOnly(loopId: string): void;
    onShowAll(): void;
  };
  onSelectLoop(loopId: string, actId?: string): void;
  onSelectMilestone(milestoneId: string): void;
};

function Backdrop({ layout, content }: Pick<PromiseGraphProps, 'layout'> & { content: Box }) {
  const { xT, days } = layout;
  const last = days.at(-1);
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
      {days.map((day, index) => (
        <line
          key={day.date}
          className={index > 0 && day.date.endsWith('-01') ? 'month-line' : 'day-line'}
          x1={day.x}
          y1={0}
          x2={day.x}
          y2={layout.height}
          strokeDasharray={index === 0 ? '2 4' : undefined}
        />
      ))}
      {last && (
        <line
          x1={last.x + last.width}
          y1={0}
          x2={last.x + last.width}
          y2={layout.height}
          stroke="var(--rule-2)"
          strokeDasharray="2 4"
        />
      )}
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
    onDayWidth,
    onResetDayWidths,
    index,
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
  const { xT } = layout;
  // x range of the days from `before` days before T to `after` days after it.
  const daysAroundT = useCallback(
    (before: number, after: number): [number, number] => {
      const { days } = layout,
        at = Math.max(
          0,
          days.findIndex((day) => xT >= day.x && xT < day.x + day.width),
        );
      const first = days[Math.max(0, at - before)],
        last = days[Math.min(days.length - 1, at + after)];
      return [first.x, last.x + last.width];
    },
    [layout, xT],
  );
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
            ? fitWidth(...daysAroundT(4, 3), layout.trunkY, canvas)
            : preset === 'month'
              ? fitWidth(...daysAroundT(25, 5), layout.trunkY, canvas)
              : zoomAround(current, preset, { x: canvas.width / 2, y: canvas.height / 2 });
      void flow.setViewport(view, { duration: 200 });
    },
    [sizeNow, flow, content, daysAroundT, layout.trunkY],
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
      const canvas = sizeNow(),
        fit = fitViewport(box, canvas, JUMP_PADDING, 1.5);
      // A long loop would fit only at an unreadable zoom; show its start at a reading zoom instead.
      const view =
        fit.zoom >= JUMP_MIN_ZOOM
          ? fit
          : {
              zoom: JUMP_MIN_ZOOM,
              x: JUMP_PADDING - box.x0 * JUMP_MIN_ZOOM,
              y: (canvas.height - (box.y1 - box.y0) * JUMP_MIN_ZOOM) / 2 - box.y0 * JUMP_MIN_ZOOM,
            };
      void flow.setViewport(view, { duration: 200 });
    },
    [layout, sizeNow, flow],
  );

  // The loop list: open by default where the canvas has room, remembered per browser.
  const [listOpen, setListOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LIST_KEY);
    } catch {
      // Blocked storage: fall back to the screen width.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setListOpen(stored === null ? window.innerWidth >= LIST_MIN_SCREEN : stored === 'open');
  }, []);
  const toggleList = useCallback(() => {
    setListOpen((value) => {
      try {
        window.localStorage.setItem(LIST_KEY, value ? 'closed' : 'open');
      } catch {
        // Blocked storage keeps the choice for this page view only.
      }
      return !value;
    });
  }, []);
  // A loop hidden by "Show only" comes back first; the jump waits for the layout that holds it.
  const pendingJump = useRef<string | null>(null);
  const jump = useCallback(
    (loopId: string) => {
      setActiveId(loopId);
      if (layout.branches.some((branch) => branch.loopId === loopId)) zoomToLoop(loopId);
      else {
        pendingJump.current = loopId;
        index.onToggleOnly(loopId);
      }
    },
    [layout, zoomToLoop, index],
  );
  useEffect(() => {
    const loopId = pendingJump.current;
    if (loopId && layout.branches.some((branch) => branch.loopId === loopId)) {
      pendingJump.current = null;
      zoomToLoop(loopId);
    }
  }, [layout, zoomToLoop]);

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
    (event: PointerEvent, glyph: ActGlyph, target: DragTarget) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      // On touch the canvas owns movement (pan and pinch); a tap still opens the loop.
      const touch = event.pointerType === 'touch';
      const zoom = flow.getViewport().zoom,
        x0 = event.clientX,
        y0 = event.clientY,
        dayWidth = glyph.dayEndX - glyph.dayStartX,
        fraction0 = (glyph.x - glyph.dayStartX) / dayWidth,
        shift0 = offsetsRef.current.loops[glyph.loopId] ?? 0,
        card0 = offsetsRef.current.cards?.[glyph.id] ?? { dx: 0, dy: 0 };
      // A card moves freely; an icon picks one axis: sideways inside its day, or the whole branch up or down.
      let mode: 'card' | 'x' | 'y' | null = null,
        last: DragChange | null = null;
      const changeAt = (move: globalThis.PointerEvent): DragChange => {
        const dx = (move.clientX - x0) / zoom,
          dy = (move.clientY - y0) / zoom;
        if (mode === 'card')
          return { kind: 'cards', id: glyph.id, dx: card0.dx + dx, dy: card0.dy + dy };
        if (mode === 'x')
          return {
            kind: 'acts',
            id: glyph.id,
            fraction: Math.min(1, Math.max(0, fraction0 + dx / dayWidth)),
          };
        return { kind: 'loops', id: glyph.loopId, shift: shift0 + dy };
      };
      const onMove = (move: globalThis.PointerEvent) => {
        const dx = move.clientX - x0,
          dy = move.clientY - y0;
        if (!mode) {
          if (Math.hypot(dx, dy) < DRAG_START_PX) return;
          mode = target === 'card' ? 'card' : Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        }
        if (touch) return;
        last = changeAt(move);
        onDrag(last, false);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (!mode) {
          onSelectLoop(glyph.loopId, glyph.id);
          return;
        }
        if (touch || !last) return;
        onDrag(last, true);
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
        className={`canvas-stage lod-${lod}${viewport.zoom < CARD_MIN_ZOOM ? ' cards-off' : ''}${listOpen ? ' list-open' : ''}`}
      >
        <div className="canvas-corner">
          <AxisMenu onResetWidths={onResetDayWidths} />
        </div>
        <div className="canvas-axis">
          <TimeAxis
            days={layout.days}
            xT={xT}
            onResize={onDayWidth}
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
              <Backdrop layout={layout} content={content} />
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
          listOpen={listOpen}
          onList={toggleList}
        />
        {listOpen && (
          <LoopIndex
            entries={index.entries}
            only={index.only}
            activeId={activeId}
            onJump={jump}
            onToggleOnly={index.onToggleOnly}
            onShowAll={index.onShowAll}
            onClose={toggleList}
          />
        )}
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
