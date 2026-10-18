'use client';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  EVENT_KINDS,
  GEOMETRY,
  KIND_LABEL,
  PLUS_GAP,
  STATUS_LABEL,
  STATUS_TONE,
  type Density,
  type LayoutHandoff,
  type LayoutMilestone,
  type Tone,
  type TrackerLayout,
} from '../../tracker';
import { svgPoint } from './drag';
import { openScale, wheelZoomFactor, zoomTarget } from './scale';
import { Icon, KIND_COLOR, KindIcon, SvgIcon } from './icons';

const { X0, SIDE, AXIS_Y, TRUNK_Y, TOP, INDENT, MAX_DAY_WIDTH } = GEOMETRY;
// The bin floats over the bottom of the graph, so the New team pill needs room above it.
const TEAM_PILL_ROOM = 28;
const ZOOM_STEP = 1.5;
const REVEAL_ZOOM = 2;
const REVEAL_FLASH_MS = 1500;
const REVEAL_PAD = 40;
const TIP_ROOM = 180;

export type PopKind = 'act' | 'stack';
export type DatePreview = { kind: 'item' | 'ms'; id: string; x: number; label?: string };
/** A new key asks the graph to bring the row into view again, even for the same row. */
export type Reveal = { rowId: string; key: number };

type Props = {
  layout: TrackerLayout;
  edit: boolean;
  selectedMs: string | null;
  selectedRow?: string | null;
  flash: string | null;
  focusRow?: string | null;
  focusMs?: string | null;
  lifted?: string | null;
  preview?: DatePreview | null;
  /** While an event waits for its new work item, a click on a row picks that row. */
  moving?: boolean;
  reveal?: Reveal | null;
  /** Units per day; one unit is one pixel. */
  onZoom: (dayWidth: number) => void;
  /** The visible width of the time line, measured on every resize. */
  onSpan?: (width: number) => void;
  /** The width is measured and nobody zoomed yet, so the graph opens at its first view. */
  opening?: boolean;
  onMoveTo?: (workItemId: string | null) => void;
  onToggleRow: (workItemId: string) => void;
  onToggleTeam: (teamId: string) => void;
  onReveal: (workItemIds: string[]) => void;
  /** Without it, rows have no focus button. */
  onFocusItem?: (workItemId: string) => void;
  /** Without it, team heads have no focus button. */
  onFocusTeam?: (teamId: string) => void;
  onHandoff?: (workItemId: string) => void;
  /** A click on a row label or its line; without it a row click does nothing. */
  onRow?: (workItemId: string) => void;
  onPop: (kind: PopKind, id: string, anchor: Element) => void;
  /** Without it, the milestone circles and the deadline diamonds show information only. */
  onMilestone?: (milestoneId: string) => void;
  onAddEvent: (workItemId: string) => void;
  onNewMilestone: () => void;
  onNewTeam: () => void;
  onBackground: () => void;
  /** Without it, the zoom corner has no full view button. */
  full?: boolean;
  onFull?: () => void;
  /** A click, Enter or Space on a team summary row opens or collapses the team. */
  onCollapse?: (teamId: string) => void;
  density?: Density;
  /** Without it, the zoom corner has no view menu (row height, expand and collapse all). */
  onDensity?: (density: Density) => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
};

const DENSITY_LABEL: Record<Density, string> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
  dense: 'Dense',
};
// The smallest target a pointer or a finger still hits on a Dense row.
const MIN_HIT = 12;

const color = (tone: Tone) => `var(--${tone})`;
// Status colours are tuned for lines; text takes the darker -ink step where one exists, for AA contrast.
const ink = (tone: Tone) => `var(--${tone}-ink, var(--${tone}))`;
const cls = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const atFit = (L: TrackerLayout) => L.zoom <= 1 + 1e-9;

function groupBy<T extends { workItemId: string }>(list: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const x of list) map.set(x.workItemId, [...(map.get(x.workItemId) ?? []), x]);
  return map;
}

const TARGETS =
  '[data-teamsum],[data-eyerow],[data-eyeteam],[data-focusitem],[data-focusteam],[data-show],[data-handoff],[data-act],[data-ms],[data-goal],[data-plus],[data-newms],[data-newteam],[data-rowlabel],[data-loop]';
const HAND_ICON = { up: 'cornerUp', down: 'cornerDown', both: 'upDown' } as const;
const diamond = (s: number) => `M0 ${-s} L${s} 0 L0 ${s} L${-s} 0 Z`;
const DIAMOND = diamond(6);
const ROWS = '[data-loop],[data-act],[data-rowlabel],[data-plus]';

function MilestoneMark({ m }: { m: LayoutMilestone }) {
  return (
    <>
      <circle
        className="ms-c"
        r={8}
        style={{ stroke: color(m.stroke), fill: m.filled ? color(m.tone) : 'var(--panel)' }}
      />
      {m.icon === 'tick' && <path className="ms-i" d="M-3.5 0 l2.5 2.5 l4.5 -5" />}
      {m.icon === 'bang' && (
        <>
          <path className="ms-i" d="M0 -4 V1" />
          <circle className="ms-dot" cy={4} r={1.2} />
        </>
      )}
    </>
  );
}

export function TrackerGraph(props: Props) {
  const { layout: L, edit, selectedMs, focusRow, focusMs, lifted, preview } = props;
  const lv = L.level;
  const dots = lv.icon === 0;
  const events = groupBy(L.eventGroups);
  const handByGroup = new Map(L.handoffs.flatMap((h) => (h.groupId ? [[h.groupId, h]] : [])));
  const deadlines = groupBy(L.deadlines);
  const chips = groupBy(L.chips);
  const dim = new Set(L.rows.filter((r) => r.dimmed).map((r) => r.id));
  const dimCls = (id: string) => dim.has(id) && 'dim';
  const xt = L.tLine.x;
  const H = L.height + (edit ? TEAM_PILL_ROOM : 0);
  const BODY = H - TOP;
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const headTime = useRef<HTMLDivElement>(null);
  const timeSvg = useRef<SVGSVGElement>(null);
  const latest = useRef({
    L,
    onZoom: props.onZoom,
    onSpan: props.onSpan,
    onBackground: props.onBackground,
  });
  useLayoutEffect(() => {
    latest.current = {
      L,
      onZoom: props.onZoom,
      onSpan: props.onSpan,
      onBackground: props.onBackground,
    };
  });

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const report = () => latest.current.onSpan?.(el.clientWidth);
    report();
    const watch = new ResizeObserver(report);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  // Wheel events can arrive faster than renders, so the next zoom builds on the one still pending.
  const anchor = useRef<{ dayWidth: number; t: number; clientX: number; open?: boolean } | null>(
    null,
  );
  /** A factor of 0 fits the window to the width again; zooming out stops at the fit. */
  const zoomBy = useCallback((factor: number, clientX?: number) => {
    const { L: now, onZoom, onBackground } = latest.current;
    const el = scroller.current;
    const svg = timeSvg.current;
    const from = anchor.current?.dayWidth ?? now.dayWidth;
    const dayWidth = zoomTarget(now, from, factor);
    if (!el || !svg || same(dayWidth, from)) return;
    const box = el.getBoundingClientRect();
    const cx =
      clientX === undefined
        ? box.left + box.width / 2
        : Math.min(box.right, Math.max(box.left, clientX));
    const t = anchor.current?.t ?? now.t(svgPoint(svg, cx, box.top).x);
    anchor.current = { dayWidth, t, clientX: anchor.current?.clientX ?? cx };
    // A pop stays where its anchor was, so it closes before the anchor moves.
    onBackground();
    onZoom(dayWidth);
  }, []);
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scroller.current;
    const svg = timeSvg.current;
    if (!a || !el || !svg || !same(a.dayWidth, L.dayWidth)) return;
    anchor.current = null;
    const scale = svg.getBoundingClientRect().width / (L.width - SIDE);
    el.scrollLeft = (L.x(a.t) - SIDE) * scale - (a.clientX - el.getBoundingClientRect().left);
    // On a phone the whole graph is wider than the screen and scrolls as well, so T needs both.
    if (a.open && body.current) body.current.scrollLeft = body.current.scrollWidth;
  }, [L]);

  useEffect(() => {
    const el = root.current;
    const pinned = head.current;
    if (!el || !pinned) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomBy(wheelZoomFactor(event.deltaY, event.deltaMode), event.clientX);
      } else if (pinned.contains(event.target as Node) && event.deltaX && scroller.current) {
        // The pinned axis has no scroll of its own, so a sideways swipe on it moves the time line.
        event.preventDefault();
        scroller.current.scrollLeft += event.deltaX;
      }
    };
    // React registers wheel listeners as passive, and a passive listener cannot stop the page zoom.
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // The pinned axis sits outside the scrolling graph, so it copies the sideways scroll of the rows.
  const syncHead = useCallback(() => {
    if (head.current && body.current) head.current.scrollLeft = body.current.scrollLeft;
    if (headTime.current && scroller.current)
      headTime.current.scrollLeft = scroller.current.scrollLeft;
  }, []);
  useEffect(() => {
    const els = [body.current, scroller.current];
    els.forEach((el) => el?.addEventListener('scroll', syncHead, { passive: true }));
    return () => els.forEach((el) => el?.removeEventListener('scroll', syncHead));
  }, [syncHead]);
  useLayoutEffect(syncHead);

  // Scrolls that bring a row into view (focus, scrollIntoView) must stop below the pinned axis,
  // and on a phone the axis pins below the rail, whose height depends on its content.
  useLayoutEffect(() => {
    const pinned = head.current;
    if (!pinned) return;
    const doc = document.documentElement;
    const measure = () => {
      doc.style.setProperty('--tk-axis-h', `${pinned.offsetHeight}px`);
      const rail = document.querySelector<HTMLElement>('.rail');
      const sticky =
        rail &&
        /sticky|fixed/.test(getComputedStyle(rail).position) &&
        rail.offsetWidth >= window.innerWidth - 1;
      doc.style.setProperty('--tk-top', `${sticky ? rail.offsetHeight : 0}px`);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(pinned);
    const rail = document.querySelector('.rail');
    if (rail) watch.observe(rail);
    window.addEventListener('resize', measure);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', measure);
      doc.style.removeProperty('--tk-axis-h');
      doc.style.removeProperty('--tk-top');
    };
  }, []);

  const [revealed, setRevealed] = useState<{ id: string; key: number } | null>(null);
  const pendingReveal = useRef<Reveal | null>(null);
  const showRow = useCallback((target: Reveal) => {
    const { L: now } = latest.current;
    const el = scroller.current;
    const svg = timeSvg.current;
    if (!el || !svg || !now.rows.some((r) => r.id === target.rowId)) return;
    root.current
      ?.querySelector(`svg.pg-side [data-rowlabel="${target.rowId}"]`)
      ?.scrollIntoView({ block: 'center', inline: 'nearest' });
    const xs = [
      ...now.segments.filter((s) => s.workItemId === target.rowId).flatMap((s) => [s.x1, s.x2]),
      ...now.eventGroups.filter((g) => g.workItemId === target.rowId).map((g) => g.x),
    ];
    const lo = Math.min(...xs, now.tLine.x) - REVEAL_PAD;
    const hi = Math.max(...xs, lo + 2 * REVEAL_PAD) + REVEAL_PAD;
    const scale = svg.getBoundingClientRect().width / (now.width - SIDE);
    // A drawer next to the graph covers the right part of the time line, so the row centres in the rest.
    const cover = root.current?.closest('.gwrap')?.querySelector(':scope > .drawer-slot > .drawer');
    const coverLeft = cover?.getBoundingClientRect().left ?? Infinity;
    const shown = Math.min(el.clientWidth, coverLeft - el.getBoundingClientRect().left);
    const view = (shown > 2 * REVEAL_PAD * scale ? shown : el.clientWidth) / scale;
    // A row longer than the view shows its latest part, where the news is.
    const left = hi - lo <= view ? (lo + hi - view) / 2 : hi - view;
    el.scrollLeft = (left - SIDE) * scale;
    setRevealed({ id: target.rowId, key: target.key });
  }, []);
  const revealKey = props.reveal?.key;
  const revealRow = props.reveal?.rowId;
  useEffect(() => {
    if (revealKey === undefined || revealRow === undefined) return;
    const target = { rowId: revealRow, key: revealKey };
    const now = latest.current.L;
    if (!atFit(now)) return showRow(target);
    pendingReveal.current = target;
    latest.current.onZoom(Math.min(MAX_DAY_WIDTH, REVEAL_ZOOM * now.fitDayWidth));
  }, [revealKey, revealRow, showRow]);
  useLayoutEffect(() => {
    const target = pendingReveal.current;
    if (!target || atFit(L)) return;
    pendingReveal.current = null;
    showRow(target);
  }, [L, showRow]);
  const opening = props.opening ?? false;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!opening || !el || anchor.current || pendingReveal.current) return;
    const { L: now, onZoom } = latest.current;
    const open = openScale(now);
    anchor.current = {
      dayWidth: open.dayWidth,
      t: open.rightMs,
      clientX: el.getBoundingClientRect().right,
      open: true,
    };
    onZoom(open.dayWidth);
  }, [opening]);

  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setRevealed(null), REVEAL_FLASH_MS);
    return () => clearTimeout(timer);
  }, [revealed]);
  const flash = revealed?.id ?? props.flash;

  // An SVG title shows only on hover, and the handoff text must also show on keyboard focus.
  const [tip, setTip] = useState<{ text: string; x: number; y: number; align: string } | null>(
    null,
  );
  const showTip = (el: Element, text: string) => {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2 - box.left;
    const align = x < TIP_ROOM ? 'start' : x > box.width - TIP_ROOM ? 'end' : 'mid';
    setTip({ text, x, y: r.top - box.top, align });
  };
  const hideTip = () => setTip(null);
  const [menu, setMenu] = useState<{ fromId: string; x: number; y: number; align: string } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const menuMark = menu ? L.handoffs.find((h) => h.fromId === menu.fromId) : undefined;
  // A poll, a hide or a filter can take the source mark away while its list is open.
  if (menu && !menuMark) setMenu(null);
  const menuGroup = menuMark?.groupId
    ? L.eventGroups.find((g) => g.topId === menuMark.groupId)
    : undefined;
  const menuStack = menuGroup && menuGroup.eventIds.length > 1 ? menuGroup : undefined;
  const closeMenu = (refocus: boolean) => {
    const from = menu?.fromId;
    setMenu(null);
    if (from && refocus)
      root.current?.querySelector<SVGElement>(`svg.pg [data-handoff="${from}"]`)?.focus();
  };
  const openMenu = (el: Element, h: LayoutHandoff) => {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2 - box.left;
    const align = x < TIP_ROOM ? 'start' : x > box.width - TIP_ROOM ? 'end' : 'mid';
    setMenu({ fromId: h.fromId, x, y: r.bottom - box.top, align });
  };
  const floating = !!tip || !!menu;
  useEffect(() => {
    if (!floating) return;
    const hide = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setTip(null);
      setMenu(null);
    };
    // Capture sees the scroll of every container, and any of them moves the mark away from its tip.
    document.addEventListener('scroll', hide, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', hide, { capture: true });
  }, [floating]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onDown = (event: PointerEvent) => {
      const t = event.target as Element;
      if (!menuRef.current?.contains(t) && !t.closest?.('[data-handoff]')) setMenu(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menu]);
  const [viewMenu, setViewMenu] = useState(false);
  const viewRef = useRef<HTMLSpanElement>(null);
  const viewId = `view-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  useEffect(() => {
    if (!viewMenu) return;
    viewRef.current?.querySelector<HTMLElement>('.view-pop [aria-pressed="true"]')?.focus();
    const onDown = (event: PointerEvent) => {
      if (!viewRef.current?.contains(event.target as Node)) setViewMenu(false);
    };
    // The menu closes on Esc wherever the focus is, as the screen leaves Esc to it while it is open.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      const inside = viewRef.current?.contains(document.activeElement);
      setViewMenu(false);
      if (inside) viewRef.current?.querySelector<HTMLElement>('.view-btn')?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [viewMenu]);
  // Label text measures differ by glyph, so a clip keeps a long label off the buttons.
  const clipId = `labels-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const labelEnd = X0 - (props.onFocusItem ? 54 : 36);

  const run = (target: Element) => {
    const el = target.closest<SVGElement>(TARGETS);
    const d = el?.dataset;
    if (d?.teamsum) return props.onCollapse?.(d.teamsum);
    if (d?.eyerow) return props.onToggleRow(d.eyerow);
    if (d?.eyeteam) return props.onToggleTeam(d.eyeteam);
    if (d?.focusitem) return props.onFocusItem?.(d.focusitem);
    if (d?.focusteam) return props.onFocusTeam?.(d.focusteam);
    if (d?.show) return props.onReveal(d.show.split(','));
    // In move mode the graph background and any other target end the move, as in the prototype.
    if (props.moving) {
      const row = target.closest<SVGElement>(ROWS)?.dataset;
      return props.onMoveTo?.(
        row ? (row.loop ?? row.in ?? row.rowlabel ?? row.plus ?? null) : null,
      );
    }
    if (!el || !d) return props.onBackground();
    if (d.handoff) {
      setTip(null);
      const h = L.handoffs.find((x) => x.fromId === d.handoff);
      if (!h) return;
      // A stack also needs a way to its events, so it always opens the list.
      if (h.targets.length === 1 && !d.stack) return props.onHandoff?.(h.targets[0].id);
      if (menu?.fromId === h.fromId) return setMenu(null);
      return openMenu(el, h);
    }
    if (d.act) return props.onPop(d.stack ? 'stack' : 'act', d.stack ?? d.act, el);
    if (d.ms) return props.onMilestone?.(d.ms);
    if (d.goal) return props.onMilestone?.(d.goal);
    if (d.plus) return props.onAddEvent(d.plus);
    if (d.newms) return props.onNewMilestone();
    if (d.newteam) return props.onNewTeam();
    if (d.rowlabel) return props.onRow?.(d.rowlabel);
    if (d.loop) return props.onRow?.(d.loop);
  };
  const onClick = (event: MouseEvent<SVGSVGElement>) => run(event.target as Element);
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const target = event.target as Element;
    if ((event.key !== 'Enter' && event.key !== ' ') || target.getAttribute('role') !== 'button')
      return;
    event.preventDefault();
    run(target);
  };
  const svgProps = { onClick, onKeyDown };
  const button = (label: string) => ({ role: 'button', tabIndex: 0, 'aria-label': label });
  const rowCls = (id: string) =>
    cls(focusRow === id && 'focus', flash === id && 'flash', props.selectedRow === id && 'sel');
  const bands = (x: number, width: number) =>
    L.lanes.map((lane) => (
      <rect
        key={`band-${lane.teamId}`}
        className={cls('lane-band', lane.alt && 'alt')}
        x={x}
        y={lane.top}
        width={width}
        height={lane.bottom - lane.top}
      />
    ));

  const sideHead = (
    <svg
      className="tg pg-top pg-top-side"
      viewBox={`0 0 ${SIDE} ${TOP}`}
      style={{ width: SIDE }}
      role="group"
      aria-label="Milestones"
      {...svgProps}
    >
      <text className="lane-name" x={12} y={TRUNK_Y + 4}>
        MILESTONES
      </text>
      {edit && (
        <g
          className="pill"
          data-newms="1"
          transform={`translate(112 ${TRUNK_Y - 8})`}
          {...button('New milestone')}
        >
          <rect width={104} height={16} rx={8} />
          <text x={52} y={11.5} textAnchor="middle">
            + New milestone
          </text>
        </g>
      )}
      <line className="divider" x1={SIDE - 0.5} x2={SIDE - 0.5} y1={0} y2={TOP} />
    </svg>
  );

  const side = (
    <svg
      className="tg pg-side"
      viewBox={`0 ${TOP} ${SIDE} ${BODY}`}
      style={{ width: SIDE }}
      role="group"
      aria-label="Teams and work items"
      {...svgProps}
    >
      {bands(0, SIDE)}
      <clipPath id={clipId}>
        <rect x={0} y={0} width={labelEnd} height={H} />
      </clipPath>
      {L.lanes.map((lane) => {
        const { summary, oneLine, top, head } = lane;
        const dense = head < 28;
        // Capitals are about 7.6 units tall, so a baseline 3.8 below the centre centres the name.
        const line1 = oneLine ? top + head / 2 + 3.8 : top + (dense ? 10 : 11.5);
        const line2 = top + (dense ? 20.5 : 23.5);
        const btn = oneLine ? (dense ? 14 : 16) : dense ? 12 : 14;
        const by = (oneLine ? top + head / 2 : line2 - 4) - btn / 2;
        // An empty team has nothing to open or collapse, so its summary is plain text.
        const toggles = summary.count > 0;
        const counts = [
          { n: summary.late, word: 'late', cls: 'late' },
          { n: summary.notYet, word: 'not yet', cls: undefined },
          { n: summary.done, word: 'done', cls: 'done' },
        ].filter((p) => p.n > 0);
        return (
          <Fragment key={lane.teamId}>
            {toggles ? (
              <rect
                className="sum-hit"
                data-teamsum={lane.teamId}
                x={0.5}
                y={top + 0.5}
                width={SIDE - 1}
                height={head - 1}
                aria-expanded={!lane.collapsed}
                {...button(summary.ariaLabel)}
              >
                <title>{`${summary.ariaLabel}. ${lane.collapsed ? 'Expand' : 'Collapse'} the team`}</title>
              </rect>
            ) : null}
            {toggles && (
              <g
                className="sum-chev"
                transform={lane.collapsed ? `rotate(-90 14 ${line1 - 3.8})` : undefined}
              >
                <SvgIcon name="chev" x={14} y={line1 - 3.8} size={12} />
              </g>
            )}
            <text
              className={cls(
                'lane-name',
                'sum-name',
                lane.collapsed && summary.changed && 'changed',
              )}
              x={24}
              y={line1}
            >
              {lane.label}
              <tspan className="sum-count"> · {summary.count}</tspan>
              {oneLine && counts.length > 0 && (
                <tspan className="sum-counts" dx={8}>
                  {counts.map((p, i) => (
                    <tspan key={p.word} className={p.cls}>
                      {i ? ' · ' : ''}
                      {p.n} {p.word}
                    </tspan>
                  ))}
                </tspan>
              )}
              {lane.label !== lane.name.toUpperCase() && <title>{lane.name}</title>}
            </text>
            {!oneLine && counts.length > 0 && (
              <text className="sum-counts" x={24} y={line2}>
                {counts.map((p, i) => (
                  <tspan key={p.word} className={p.cls}>
                    {i ? ' · ' : ''}
                    {p.n} {p.word}
                  </tspan>
                ))}
              </text>
            )}
            {props.onFocusTeam && (
              <g
                className={cls('eye', 'focus-btn', lane.focused && 'on')}
                data-focusteam={lane.teamId}
                aria-pressed={lane.focused}
                {...button(lane.focusLabel)}
              >
                <rect x={X0 - 43 - btn / 2} y={by} width={btn} height={btn} rx={4} />
                <SvgIcon name="focus" x={X0 - 43} y={by + btn / 2} size={btn - 6} />
                <title>
                  {lane.focused ? 'Leave focus' : 'Focus: show only this team and the work from it'}
                </title>
              </g>
            )}
            <g className="eye" data-eyeteam={lane.teamId} {...button(lane.eyeLabel)}>
              <rect x={X0 - 24 - btn / 2} y={by} width={btn} height={btn} />
              <SvgIcon name="eye" x={X0 - 24} y={by + btn / 2} size={btn - 5} />
            </g>
            {lane.guide && (
              <line className="guide" x1={16} x2={16} y1={lane.guide.y1} y2={lane.guide.y2} />
            )}
          </Fragment>
        );
      })}
      {edit && (
        <g
          className="pill"
          data-newteam="1"
          transform={`translate(12 ${(L.lanes.at(-1)?.bottom ?? TOP) + 6})`}
          {...button('New team')}
        >
          <rect width={84} height={16} rx={8} />
          <text x={42} y={11.5} textAnchor="middle">
            + New team
          </text>
        </g>
      )}
      {L.rows.map((r) => {
        const indent = r.depth * INDENT;
        return (
          <Fragment key={`side-${r.id}`}>
            <rect
              className={cls('hit', rowCls(r.id))}
              data-rowlabel={r.id}
              x={22}
              y={r.y - lv.hit / 2}
              width={SIDE - 22}
              height={lv.hit}
            />
            <line className="guide" x1={16} x2={24 + indent} y1={r.y} y2={r.y} />
            <text
              className={cls(
                'row-label',
                r.changed && 'changed',
                r.dimmed && 'dim',
                selectedMs && r.milestoneId === selectedMs && 'sel',
              )}
              x={28 + indent}
              y={r.y + lv.labelDy}
              style={{ fontSize: lv.font }}
              clipPath={`url(#${clipId})`}
            >
              {r.label}
              <title>{r.title}</title>
            </text>
            <rect
              className="label-hit"
              data-rowlabel={r.id}
              x={26}
              y={r.y - Math.min(10, lv.hit / 2)}
              width={X0 - (props.onFocusItem ? 82 : 64)}
              height={Math.min(20, lv.hit)}
            >
              <title>
                {edit ? 'Open the details, or drag onto a milestone to add it' : 'Open the details'}
              </title>
            </rect>
            {props.onFocusItem && (
              <g
                className={cls('eye', 'focus-btn', r.focused && 'on')}
                data-focusitem={r.id}
                aria-pressed={r.focused}
                {...button(r.focusLabel)}
              >
                <rect
                  x={X0 - 43 - lv.btn / 2}
                  y={r.y - lv.btn / 2}
                  width={lv.btn}
                  height={lv.btn}
                  rx={Math.min(4, lv.btn / 4)}
                />
                <SvgIcon name="focus" x={X0 - 43} y={r.y} size={lv.btnIcon} />
                <title>
                  {r.focused ? 'Leave focus' : 'Focus: show only this and the work from it'}
                </title>
              </g>
            )}
            <g className="eye" data-eyerow={r.id} {...button(r.eyeLabel)}>
              <rect x={X0 - 24 - lv.btn / 2} y={r.y - lv.btn / 2} width={lv.btn} height={lv.btn} />
              <SvgIcon name="eye" x={X0 - 24} y={r.y} size={lv.btnIcon} />
            </g>
          </Fragment>
        );
      })}
      <line className="divider" x1={SIDE - 0.5} x2={SIDE - 0.5} y1={TOP} y2={H} />
    </svg>
  );

  const grid = L.ticks.map((tick) => (
    <line
      key={`grid-${tick.date}`}
      className="grid"
      x1={tick.x}
      x2={tick.x}
      y1={TRUNK_Y}
      y2={L.height}
    />
  ));
  const tline = <line className="tline" x1={xt} x2={xt} y1={L.tLine.y1} y2={L.tLine.y2} />;
  const timeWidth = { width: L.width - SIDE };

  const timeHead = (
    <svg
      className="tg pg-top pg-top-time"
      viewBox={`${SIDE} 0 ${L.width - SIDE} ${TOP}`}
      style={timeWidth}
      role="group"
      aria-label="Dates and milestones"
      {...svgProps}
    >
      {grid}
      {L.ticks.map(
        (tick) =>
          tick.labelled && (
            <text key={`tick-${tick.date}`} className="tick" x={tick.x} y={AXIS_Y}>
              {tick.label}
            </text>
          ),
      )}
      {tline}
      <g className="tpill">
        <rect x={xt - 44} y={AXIS_Y - 12} width={88} height={17} rx={8.5} />
        <text x={xt} y={AXIS_Y}>
          {L.tLine.label}
        </text>
      </g>
      <line className="trunk" x1={L.trunk.x1} x2={L.trunk.x2} y1={L.trunk.y} y2={L.trunk.y} />
      {L.trunkSegments.map((s) => (
        <line
          key={`trunk-${s.milestoneId}`}
          className="trunk-seg"
          x1={s.x1}
          x2={s.x2}
          y1={s.y}
          y2={s.y}
          style={{ stroke: color(s.tone) }}
        />
      ))}
      {L.milestones.map((m) => {
        const moved = preview?.kind === 'ms' && preview.id === m.id ? preview : null;
        const mx = moved ? moved.x : m.x;
        return (
          <g
            key={m.id}
            className={cls(
              'ms',
              m.changed && 'changed',
              selectedMs === m.id && 'sel',
              focusMs === m.id && 'glow',
            )}
            data-ms={m.id}
            transform={`translate(${mx} ${m.y})`}
            {...button(m.ariaLabel)}
          >
            <rect className="ms-hit" x={-15} y={-15} width={30} height={30} />
            <MilestoneMark m={m} />
            <text
              className={cls('ms-label', m.changed && 'changed')}
              x={m.labelX - m.x}
              y={m.labelY - m.y}
              textAnchor={m.anchor}
              style={m.changed ? undefined : { fill: ink(m.labelTone) }}
            >
              {moved?.label ?? m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );

  const time = (
    <svg
      ref={timeSvg}
      className="tg pg"
      viewBox={`${SIDE} ${TOP} ${L.width - SIDE} ${BODY}`}
      style={timeWidth}
      role="group"
      aria-label={L.window.label}
      {...svgProps}
    >
      {bands(SIDE, L.width - SIDE)}
      {grid}
      {L.lanes.map(({ teamId, top, head, summary }) => (
        <g
          key={`sum-${teamId}`}
          className="sum"
          data-teamsum={summary.count > 0 ? teamId : undefined}
        >
          {summary.count > 0 && (
            <rect className="sum-hit" x={SIDE} y={top} width={L.width - SIDE} height={head} />
          )}
        </g>
      ))}
      {tline}
      {L.segments.map((s, i) =>
        s.kind === 'wait' ? (
          <g key={`wait-${s.workItemId}`} className={cls(dimCls(s.workItemId))}>
            <line
              className="wait-line"
              x1={s.x1}
              x2={s.x2}
              y1={s.y}
              y2={s.y}
              style={{ strokeWidth: Math.min(2.5, lv.seg) }}
            />
            {lv.waitText ? (
              <text
                className="wait-text"
                x={s.textX}
                y={s.textY}
                style={{ fontSize: lv.font < 12 ? 9 : undefined }}
              >
                {s.text}
              </text>
            ) : (
              <title>{s.text}</title>
            )}
          </g>
        ) : (
          <line
            key={`seg-${s.workItemId}-${i}`}
            className={cls('seg', dimCls(s.workItemId))}
            data-line={s.workItemId}
            x1={s.x1}
            x2={s.x2}
            y1={s.y}
            y2={s.y}
            style={{ stroke: color(s.tone), strokeWidth: lv.seg }}
          />
        ),
      )}
      {L.rows.map((r) => (
        <Fragment key={`row-${r.id}`}>
          <rect
            className={cls('hit', rowCls(r.id))}
            data-loop={r.id}
            x={SIDE}
            y={r.y - lv.hit / 2}
            width={L.width - SIDE}
            height={lv.hit}
            {...(props.onRow
              ? button(`${r.title}, ${STATUS_LABEL[r.status]}. Open the details`)
              : {})}
          />
          {(deadlines.get(r.id) ?? []).map((d) => (
            <g
              key={`deadline-${d.workItemId}`}
              className={cls(
                'deadline',
                d.changed && 'changed',
                dimCls(r.id),
                selectedMs === d.milestoneId && 'sel',
              )}
              data-goal={d.milestoneId}
              transform={`translate(${d.x} ${d.y})`}
              {...(props.onMilestone
                ? button(d.ariaLabel)
                : { role: 'img', 'aria-label': d.ariaLabel })}
              onPointerEnter={(event) => showTip(event.currentTarget, d.tooltip)}
              onPointerLeave={hideTip}
              onFocus={(event) => showTip(event.currentTarget, d.tooltip)}
              onBlur={hideTip}
            >
              <rect
                className="deadline-hit"
                x={-Math.max(MIN_HIT / 2, lv.diamond + 3)}
                y={-lv.hit / 2}
                width={Math.max(MIN_HIT, 2 * lv.diamond + 6)}
                height={lv.hit}
              />
              <path
                className="deadline-mark"
                d={diamond(lv.diamond)}
                style={{
                  stroke: color(d.stroke),
                  fill: d.filled ? color(d.tone) : 'var(--panel)',
                }}
              />
              {d.label && (
                <text
                  className="deadline-name"
                  x={d.labelX - d.x}
                  y={d.labelY - d.y}
                  textAnchor={d.labelAnchor}
                  style={{
                    fill: ink(d.tone === 'ink-3' ? 'ink-2' : d.tone),
                    fontSize: lv.nameFont,
                  }}
                >
                  {d.label}
                </text>
              )}
            </g>
          ))}
          {(events.get(r.id) ?? []).map((g) => {
            const n = g.eventIds.length;
            // Kinds colour the events; the row line keeps the status colour.
            const stroke = KIND_COLOR[g.kind];
            const tint = `color-mix(in srgb, ${stroke} 18%, var(--panel))`;
            // The Handoff event icon is the handoff mark itself, so its group takes the mark's hover and click.
            const hand = handByGroup.get(g.topId);
            const tipText = hand && `${hand.tooltip}\n${g.tooltip}`;
            const opens = !!hand && (hand.targets.length > 1 || n > 1);
            return (
              <g
                key={g.topId}
                className={cls(
                  'act',
                  hand && 'hand-act',
                  hand && menu?.fromId === hand.fromId && 'open',
                  lifted === g.topId && 'lift',
                  dimCls(r.id),
                )}
                data-act={g.topId}
                data-stack={n > 1 ? g.eventIds.join(',') : undefined}
                data-in={g.workItemId}
                data-kind={g.kind}
                data-handoff={hand?.fromId}
                transform={`translate(${g.x} ${g.y})`}
                {...button(hand ? `${g.ariaLabel}. ${hand.ariaLabel}` : g.ariaLabel)}
                aria-haspopup={opens ? 'menu' : undefined}
                aria-expanded={opens ? menu?.fromId === hand.fromId : undefined}
                {...(tipText
                  ? {
                      onPointerEnter: (event) => !menu && showTip(event.currentTarget, tipText),
                      onPointerLeave: hideTip,
                      onFocus: (event) => !menu && showTip(event.currentTarget, tipText),
                      onBlur: hideTip,
                    }
                  : {})}
              >
                <g>
                  {dots && <circle className="act-hit" r={MIN_HIT / 2} />}
                  {g.changed && <circle className="halo" r={lv.r + (dots ? 3.5 : 5)} />}
                  {[2, 1]
                    .filter((k) => k <= n - 1)
                    .map((k) => (
                      <circle
                        key={k}
                        className="layer"
                        cx={-(dots ? 0.9 : 0.35) * lv.r * k}
                        r={lv.r}
                        style={{ stroke, fill: tint, strokeWidth: dots ? 1 : undefined }}
                      />
                    ))}
                  {dots ? (
                    <circle className="dot" r={lv.r} style={{ fill: stroke }} />
                  ) : (
                    <>
                      <circle
                        className="bg"
                        r={lv.r}
                        style={{ stroke, strokeWidth: lv.r >= 10 ? 2 : 1.6 }}
                      />
                      <SvgIcon kind={g.kind} x={0} y={0} size={lv.icon} color={stroke} />
                    </>
                  )}
                  {hand && hand.targets.length > 1 && lv.count > 0 && (
                    <text
                      className="hand-count"
                      x={0.8 * lv.r}
                      y={-0.6 * lv.r}
                      style={{ fontSize: lv.count }}
                    >
                      {hand.targets.length}
                    </text>
                  )}
                  {!hand && <title>{g.tooltip}</title>}
                </g>
              </g>
            );
          })}
          {edit && !r.done && (
            <g
              className="plus"
              data-plus={r.id}
              transform={`translate(${xt + PLUS_GAP} ${r.y})`}
              {...button(`Add an event to ${r.title}`)}
            >
              <circle className="plus-hit" r={Math.max(lv.plus, MIN_HIT / 2)} />
              <circle r={lv.plus} />
              <path
                d={`M${-0.45 * lv.plus} 0h${0.9 * lv.plus}M0 ${-0.45 * lv.plus}v${0.9 * lv.plus}`}
              />
              <title>{`Add an event to ${r.title}`}</title>
            </g>
          )}
          {(chips.get(r.id) ?? []).map((c) => (
            <g
              key={`chip-${c.workItemId}`}
              className={cls('chip', dimCls(r.id))}
              data-show={c.sources.join(',')}
              transform={`translate(${c.x} ${c.y})`}
              {...button(c.ariaLabel)}
            >
              {c.size < MIN_HIT && (
                <rect
                  className="chip-hit"
                  x={(c.size - MIN_HIT) / 2}
                  y={(c.size - MIN_HIT) / 2}
                  width={MIN_HIT}
                  height={MIN_HIT}
                />
              )}
              <rect width={c.size} height={c.size} rx={Math.min(4, c.size / 3)} />
              <SvgIcon name="branch" x={c.size / 2} y={c.size / 2} size={lv.chipIcon} />
              <title>{c.tooltip}</title>
            </g>
          ))}
        </Fragment>
      ))}
      {L.handoffs.map((h) => {
        if (h.groupId) return null;
        const many = h.targets.length > 1;
        return (
          <g
            key={`hand-${h.fromId}`}
            className={cls('handoff', dimCls(h.fromId), menu?.fromId === h.fromId && 'open')}
            data-handoff={h.fromId}
            transform={`translate(${h.x} ${h.y})`}
            {...button(h.ariaLabel)}
            aria-haspopup={many ? 'menu' : undefined}
            aria-expanded={many ? menu?.fromId === h.fromId : undefined}
            onPointerEnter={(event) => !menu && showTip(event.currentTarget, h.tooltip)}
            onPointerLeave={hideTip}
            onFocus={(event) => !menu && showTip(event.currentTarget, h.tooltip)}
            onBlur={hideTip}
          >
            {h.height < MIN_HIT && (
              <rect
                className="hand-hit"
                x={Math.min(0, (h.width - MIN_HIT) / 2)}
                y={(h.height - MIN_HIT) / 2}
                width={Math.max(MIN_HIT, h.width)}
                height={MIN_HIT}
              />
            )}
            <rect width={h.width} height={h.height} rx={Math.min(4, h.height / 3)} />
            <SvgIcon
              name={HAND_ICON[h.dir]}
              x={h.height / 2}
              y={h.height / 2}
              size={lv.markIcon}
              color={color(h.tone)}
            />
            {many && (
              <text
                className="hand-n"
                x={h.width - 0.35 * h.height}
                y={h.height / 2 + 3.4}
                textAnchor="end"
                style={{ fontSize: h.height >= 14 ? undefined : 8 }}
              >
                {h.targets.length}
              </text>
            )}
          </g>
        );
      })}
      {L.laneDrops.map((d) => (
        <Fragment key={`drop-${d.teamId}`}>
          <rect
            className="lane-drop"
            data-lane={d.teamId}
            x={d.x}
            y={d.y}
            width={d.width}
            height={d.height}
            rx={4}
          />
          <text className="lane-drop-text" x={d.textX} y={d.textY}>
            {d.text}
          </text>
        </Fragment>
      ))}
    </svg>
  );

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('button') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    }
  };

  return (
    <div className={cls('tgraph', edit && 'editable')} ref={root}>
      <div className="ghead" ref={head}>
        <div className="gframe">
          {sideHead}
          <div className="gtime" ref={headTime}>
            {timeHead}
          </div>
        </div>
      </div>
      <div className="gscroll" ref={body}>
        <div className="gframe">
          {side}
          <div className="gtime" ref={scroller}>
            {time}
          </div>
        </div>
      </div>
      {tip && (
        <div className={`hand-tip ${tip.align}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
      {menu && menuMark && (
        <div
          ref={menuRef}
          className={`hand-menu ${menu.align}`}
          role="menu"
          aria-label={`Handoffs from ${L.rows.find((r) => r.id === menu.fromId)?.title ?? ''}`}
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={onMenuKey}
          onBlur={(event) => {
            if (!menuRef.current?.contains(event.relatedTarget as Node | null)) setMenu(null);
          }}
        >
          <p>{menuMark.wait ? 'Hands over when done to' : 'Handed over to'}</p>
          {menuMark.targets.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                props.onHandoff?.(t.id);
              }}
            >
              <b>{t.title}</b>
              <small>{t.team}</small>
            </button>
          ))}
          {menuStack && (
            <button
              type="button"
              role="menuitem"
              className="hand-events"
              onClick={() => {
                const anchor = root.current?.querySelector(
                  `svg.pg [data-act="${menuStack.topId}"]`,
                );
                setMenu(null);
                if (anchor) props.onPop('stack', menuStack.eventIds.join(','), anchor);
              }}
            >
              <b>Show the {menuStack.eventIds.length} events here</b>
            </button>
          )}
        </div>
      )}
      <div className="zoombar" role="group" aria-label="View controls">
        {props.onDensity && (
          <span className="view-menu" ref={viewRef}>
            <button
              type="button"
              className="view-btn"
              aria-label="Row height and teams"
              title="Row height and teams"
              aria-expanded={viewMenu}
              aria-controls={viewId}
              onClick={() => setViewMenu((open) => !open)}
            >
              <Icon name="rows" size={14} />
            </button>
            {viewMenu && (
              <div id={viewId} className="view-pop" role="dialog" aria-label="Row height and teams">
                <p className="q-label">Row height</p>
                <span className="seg" role="group" aria-label="Row height">
                  {(Object.keys(DENSITY_LABEL) as Density[]).map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={props.density === d}
                      onClick={() => props.onDensity?.(d)}
                    >
                      {DENSITY_LABEL[d]}
                    </button>
                  ))}
                </span>
                <p className="q-label">Teams</p>
                <div className="row-btns">
                  <button className="btn sm" type="button" onClick={props.onExpandAll}>
                    Expand all
                  </button>
                  <button className="btn sm" type="button" onClick={props.onCollapseAll}>
                    Collapse all
                  </button>
                </div>
              </div>
            )}
          </span>
        )}
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={atFit(L)}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in (or Ctrl and the wheel)"
          disabled={L.dayWidth >= MAX_DAY_WIDTH - 1e-9}
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          <Icon name="plus" size={14} />
        </button>
        <button
          type="button"
          className="fit"
          aria-label="Fit to width"
          disabled={same(L.zoom, 1)}
          onClick={() => zoomBy(0)}
        >
          Fit
        </button>
        {props.onFull && (
          <button
            type="button"
            className="full"
            aria-label="Full view"
            aria-pressed={!!props.full}
            title={props.full ? 'Leave full view (Esc)' : 'Full view'}
            onClick={props.onFull}
          >
            <Icon name={props.full ? 'minimize' : 'maximize'} size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export function Legend() {
  const line = (background: string, label: string) => (
    <span>
      <i className="ln" style={{ background }} />
      {label}
    </span>
  );
  return (
    <div className="legend2">
      {line('var(--route)', 'Not finished')}
      {line('var(--proceed)', 'Done')}
      {line('var(--danger)', 'Not finished after its planned finish')}
      {line('var(--caution)', 'Done after its planned finish')}
      <span>
        <svg width="12" height="12" viewBox="-7 -7 14 14" aria-hidden="true">
          <path d={DIAMOND} fill="var(--ink-3)" stroke="var(--ink-3)" strokeWidth="1.5" />
        </svg>
        Milestone deadline on its work items
      </span>
      {(Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>).map((status) => (
        <span key={status} style={{ color: color(STATUS_TONE[status]) }}>
          <i className={cls('ms-sw', status !== 'planned' && 'fill')} />
          <span style={{ color: 'var(--ink-2)' }}>{STATUS_LABEL[status]}</span>
        </span>
      ))}
      <span>
        <i className="chg">Name</i>
        Changed in this change request
      </span>
      <span className="lg-kinds" role="group" aria-label="Event kinds">
        {EVENT_KINDS.map((kind) => (
          <span key={kind} style={{ color: KIND_COLOR[kind] }}>
            <KindIcon kind={kind} size={13} />
            <span className="lg-kind">{KIND_LABEL[kind]}</span>
          </span>
        ))}
      </span>
    </div>
  );
}
