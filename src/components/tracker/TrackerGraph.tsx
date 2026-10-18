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
  GEOMETRY,
  KIND_GROUPS,
  KIND_LABEL,
  PLUS_GAP,
  STATUS_LABEL,
  STATUS_TONE,
  type Density,
  type EventKind,
  type LayoutHandoff,
  type LayoutMilestone,
  type Status,
  type Tone,
  type TrackerLayout,
} from '../../tracker';
import { svgPoint } from './drag';
import { gestureFactor, openScale, wheelZoomFactor, zoomTarget } from './scale';
import { changeScroll, cutToFit, keepInView, menuPlace } from './in-view';
import { Icon, KIND_COLOR, KindIcon, SvgIcon } from './icons';
import { teamMenuItems } from './team';

const { X0, SIDE, AXIS_Y, TRUNK_Y, TOP, INDENT, MAX_DAY_WIDTH } = GEOMETRY;
// The bin floats over the bottom of the graph, so the New team pill needs room above it.
const TEAM_PILL_ROOM = 28;
const ZOOM_STEP = 1.5;
// Below this the pop is a sliver of its own padding, so it steps aside until the graph scrolls up.
const LEGEND_MIN_ROOM = 48;
const REVEAL_ZOOM = 2;
const REVEAL_FLASH_MS = 1500;
const REVEAL_PAD = 40;
const TIP_ROOM = 180;
/** The space between a menu and its anchor; `.hand-menu` moves by the same 6 px. */
const MENU_GAP = 6;
const OPEN_QUIET_MS = 300;
/** The page scroll that shows the first change of a change request above the zoom bar, or null. */
function changeInView(
  graph: HTMLElement | null,
  bar: HTMLElement,
  axis: HTMLElement | null,
): number | null {
  const marks = Array.from(graph?.querySelectorAll('svg.pg .halo') ?? []).map((mark) =>
    mark.getBoundingClientRect(),
  );
  if (!marks.length) return null;
  const board = graph?.closest('.tk.board');
  const stops = Array.from(
    board?.querySelectorAll(
      ':scope > .p-head > *, :scope > .bbar, :scope > .ro-note, .p-side, .gwrap',
    ) ?? [],
  ).map((el) => el.getBoundingClientRect().top);
  return changeScroll({
    scrollY: window.scrollY,
    viewport: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
    first: marks.reduce((a, b) => (b.top < a.top ? b : a)),
    barHeight: bar.offsetHeight,
    stickyTop:
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tk-top')) || 0,
    axisHeight: axis?.offsetHeight ?? 0,
    stops,
  });
}

type MenuPlace = { up: boolean; maxHeight: number | null };

const menuStyle = (m: { x: number; y: number; top: number; place?: MenuPlace }) => ({
  left: m.x,
  top: m.place?.up ? m.top : m.y,
  ...(m.place?.maxHeight != null
    ? { maxHeight: m.place.maxHeight, overflowY: 'auto' as const }
    : {}),
});

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
  /** Null until the browser storage is read; the popover then stays out of the page. */
  legend?: boolean | null;
  /** Without it, the zoom corner has no Legend button. */
  onLegend?: (open: boolean) => void;
};

const DENSITY_LABEL: Record<Density, string> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
  dense: 'Dense',
};
// The smallest target a pointer or a finger still hits on a Dense row.
const MIN_HIT = 12;

// A milestone is never cancelled: its cancelled members finish it (decision 6).
const MILESTONE_STATUSES = (Object.keys(STATUS_LABEL) as Status[]).filter((s) => s !== 'cancelled');

const color = (tone: Tone) => `var(--${tone})`;
// Status colours are tuned for lines; text takes the darker -ink step where one exists, for AA contrast.
const ink = (tone: Tone) => `var(--${tone}-ink, var(--${tone}))`;
const cls = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const atFit = (L: TrackerLayout) => L.zoom <= 1 + 1e-9;

/** The counts above zero of a team summary, for the empty lane of its summary row. */
const laneCounts = (s: { late: number; notYet: number; done: number; cancelled: number }) =>
  [
    { n: s.late, word: 'late', cls: 'late' },
    { n: s.notYet, word: 'not yet', cls: undefined },
    { n: s.done, word: 'done', cls: 'done' },
    { n: s.cancelled, word: 'cancelled', cls: undefined },
  ].filter((p) => p.n > 0);

function groupBy<T extends { workItemId: string }>(list: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const x of list) map.set(x.workItemId, [...(map.get(x.workItemId) ?? []), x]);
  return map;
}

const TARGETS =
  '[data-teamsum],[data-teammenu],[data-eyerow],[data-eyeteam],[data-focusitem],[data-focusteam],[data-show],[data-handoff],[data-act],[data-ms],[data-goal],[data-plus],[data-newms],[data-newteam],[data-rowlabel],[data-loop]';
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

const BACK_PAD = 3;

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
  const headSvg = useRef<SVGSVGElement>(null);
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
    // A frame wider than its box (a narrow window, not a phone) scrolls too, so T needs both.
    if (a.open && body.current) body.current.scrollLeft = body.current.scrollWidth;
  }, [L]);

  // The T line and the grid run through the axis row, so each milestone name gets the panel behind it.
  const fitBacks = useCallback(() => {
    const svg = headSvg.current;
    if (!svg) return;
    for (const back of Array.from(svg.querySelectorAll<SVGRectElement>('.label-back'))) {
      const id = CSS.escape(back.dataset.back ?? '');
      const label = svg.querySelector<SVGTextElement>(`[data-ms="${id}"] .ms-label`);
      const group = label?.parentNode;
      if (!label || !(group instanceof SVGGElement) || typeof label.getBBox !== 'function')
        continue;
      const box = label.getBBox();
      const at = group.transform.baseVal.consolidate()?.matrix;
      back.setAttribute('x', String(box.x + (at?.e ?? 0) - BACK_PAD));
      back.setAttribute('y', String(box.y + (at?.f ?? 0)));
      back.setAttribute('width', String(box.width + 2 * BACK_PAD));
      back.setAttribute('height', String(box.height));
    }
  }, []);
  useLayoutEffect(fitBacks, [L, preview, fitBacks]);

  // A row name that the sideways scroll pushes under the pinned names starts again after them.
  const fitRowNames = useCallback(() => {
    const svg = timeSvg.current;
    const el = scroller.current;
    if (!svg || !el) return;
    const left = SIDE + el.scrollLeft;
    for (const g of Array.from(svg.querySelectorAll<SVGGElement>('.deadline'))) {
      const label = g.querySelector<SVGTextElement>('.deadline-name:not(.deadline-stuck)');
      const stuck = g.querySelector<SVGTextElement>('.deadline-stuck');
      if (!label || !stuck || typeof label.getBBox !== 'function') continue;
      const gx = g.transform.baseVal.consolidate()?.matrix.e ?? 0;
      const box = label.getBBox();
      const place = keepInView({ x0: gx + box.x, x1: gx + box.x + box.width }, left);
      let text: string | null = null;
      if (place && place !== 'whole') {
        stuck.setAttribute('x', String(place.x - gx));
        text = cutToFit(label.textContent ?? '', place.room, (t) => {
          stuck.textContent = t;
          return stuck.getComputedTextLength();
        });
      }
      stuck.textContent = text ?? '';
      if (place === 'whole') label.removeAttribute('visibility');
      else label.setAttribute('visibility', 'hidden');
    }
  }, []);
  useLayoutEffect(fitRowNames, [L, fitRowNames]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitRowNames);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
    };
  }, [fitRowNames]);
  useEffect(() => {
    let mounted = true;
    // A web font that arrives later changes the width of the names.
    void document.fonts?.ready.then(() => {
      if (!mounted) return;
      fitBacks();
      fitRowNames();
    });
    return () => {
      mounted = false;
    };
  }, [fitBacks, fitRowNames]);

  useEffect(() => {
    const el = root.current;
    const pinned = head.current;
    if (!el || !pinned) return;
    // Safari sends a trackpad pinch as gesture events; without preventDefault it zooms the page.
    let gesture: number | null = null;
    type Gesture = Event & { scale: number; clientX: number };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gesture = 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const { scale, clientX } = event as Gesture;
      zoomBy(gestureFactor(gesture ?? 1, scale), clientX);
      gesture = scale;
    };
    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      gesture = null;
    };
    const gestures = 'ongesturestart' in window;
    if (gestures) {
      el.addEventListener('gesturestart', onGestureStart);
      el.addEventListener('gesturechange', onGestureChange);
      el.addEventListener('gestureend', onGestureEnd);
    }
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        if (gesture !== null) return;
        zoomBy(wheelZoomFactor(event.deltaY, event.deltaMode), event.clientX);
      } else if (pinned.contains(event.target as Node) && event.deltaX && scroller.current) {
        // The pinned axis has no scroll of its own, so a sideways swipe on it moves the time line.
        event.preventDefault();
        scroller.current.scrollLeft += event.deltaX;
      }
    };
    // React registers wheel listeners as passive, and a passive listener cannot stop the page zoom.
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (!gestures) return;
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, [zoomBy]);

  // The pinned axis sits outside the scrolling graph, so it copies the sideways scroll of the rows.
  const syncHead = useCallback(() => {
    if (head.current && body.current) head.current.scrollLeft = body.current.scrollLeft;
    // When the whole graph scrolls too, the lane counts also move past the hidden labels.
    if (body.current && scroller.current)
      scroller.current.style.setProperty(
        '--lane-shift',
        `${Math.max(0, body.current.scrollLeft - SIDE)}px`,
      );
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
  const [menu, setMenu] = useState<{
    fromId: string;
    x: number;
    y: number;
    top: number;
    align: string;
    place?: MenuPlace;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const quietUntil = useRef(0);
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
    quietUntil.current = performance.now() + OPEN_QUIET_MS;
    setMenu({ fromId: h.fromId, x, y: r.bottom - box.top, top: r.top - box.top, align });
  };
  const [teamMenu, setTeamMenu] = useState<{
    teamId: string;
    x: number;
    y: number;
    top: number;
    place?: MenuPlace;
  } | null>(null);
  const teamMenuRef = useRef<HTMLDivElement>(null);
  // A hidden team takes its name away, so the focus moves to the badge that unhides it.
  const hiddenByMenu = useRef(false);
  useEffect(() => {
    if (!hiddenByMenu.current) return;
    hiddenByMenu.current = false;
    root.current?.closest('.tk')?.querySelector<HTMLElement>('.hid-menu > summary')?.focus();
  });
  const teamMenuLane = teamMenu ? L.lanes.find((l) => l.teamId === teamMenu.teamId) : undefined;
  if (teamMenu && (!teamMenuLane || L.side >= SIDE)) setTeamMenu(null);
  const closeTeamMenu = (refocus: boolean) => {
    const teamId = teamMenu?.teamId;
    setTeamMenu(null);
    if (teamId && refocus)
      root.current?.querySelector<SVGElement>(`svg.pg-side [data-teammenu="${teamId}"]`)?.focus();
  };
  const toggleTeamMenu = (el: Element, teamId: string) => {
    if (teamMenu?.teamId === teamId) return setTeamMenu(null);
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    const r = el.getBoundingClientRect();
    quietUntil.current = performance.now() + OPEN_QUIET_MS;
    setTeamMenu({ teamId, x: r.left - box.left + 12, y: r.bottom - box.top, top: r.top - box.top });
  };
  /** The room below the anchor reaches down to the sticky zoom bar, above it up to the pinned axis. */
  const placeOf = (pop: HTMLElement | null, anchor: { y: number; top: number }): MenuPlace => {
    const box = root.current?.getBoundingClientRect();
    if (!pop || !box) return { up: false, maxHeight: null };
    const bar = barRef.current?.getBoundingClientRect();
    const bottom = box.top + anchor.y;
    const floor = Math.min(innerHeight, bar && bar.top >= bottom ? bar.top : Infinity) - 4;
    const ceiling = Math.max(0, head.current?.getBoundingClientRect().bottom ?? 0);
    return menuPlace({
      below: floor - bottom - MENU_GAP,
      above: box.top + anchor.top - MENU_GAP - ceiling,
      height: pop.scrollHeight,
    });
  };
  useLayoutEffect(() => {
    if (menu && !menu.place) setMenu({ ...menu, place: placeOf(menuRef.current, menu) });
    if (teamMenu && !teamMenu.place)
      setTeamMenu({ ...teamMenu, place: placeOf(teamMenuRef.current, teamMenu) });
  }, [menu, teamMenu]);
  // The opening may still move the page in its quiet time, so the menu then measures its anchor and
  // its room again.
  const replace = useCallback(
    <M extends { y: number; top: number; place?: MenuPlace }>(
      open: M,
      selector: string,
      pop: HTMLElement | null,
    ): M | null => {
      const box = root.current?.getBoundingClientRect();
      const el = root.current?.querySelector(selector);
      if (!box || !el) return null;
      const r = el.getBoundingClientRect();
      const at = { y: r.bottom - box.top, top: r.top - box.top };
      const place = placeOf(pop, at);
      const same =
        Math.abs(at.y - open.y) <= 2 &&
        place.up === open.place?.up &&
        place.maxHeight === open.place?.maxHeight;
      return same ? null : { ...open, ...at, place };
    },
    [],
  );
  const floating = !!tip || !!menu || !!teamMenu;
  useEffect(() => {
    if (!floating) return;
    const hide = (event: Event) => {
      // Opening a menu can move the page by a pixel; only a scroll of the person closes it.
      if (performance.now() < quietUntil.current) return;
      if (menuRef.current?.contains(event.target as Node)) return;
      if (teamMenuRef.current?.contains(event.target as Node)) return;
      setTip(null);
      setMenu(null);
      setTeamMenu(null);
    };
    const close = () => {
      setTip(null);
      setMenu(null);
      setTeamMenu(null);
    };
    // Capture sees the scroll of every container, and any of them moves the mark away from its tip.
    document.addEventListener('scroll', hide, { capture: true, passive: true });
    window.addEventListener('resize', close);
    window.addEventListener('orientationchange', close);
    return () => {
      document.removeEventListener('scroll', hide, { capture: true });
      window.removeEventListener('resize', close);
      window.removeEventListener('orientationchange', close);
    };
  }, [floating]);
  const recheck = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    recheck.current = () => {
      const handoff =
        menu && replace(menu, `svg.pg [data-handoff="${menu.fromId}"]`, menuRef.current);
      if (handoff) setMenu(handoff);
      const team =
        teamMenu &&
        replace(teamMenu, `svg.pg-side [data-teammenu="${teamMenu.teamId}"]`, teamMenuRef.current);
      if (team) setTeamMenu(team);
    };
  });
  const openKey = `${menu?.fromId ?? ''}/${teamMenu?.teamId ?? ''}`;
  useEffect(() => {
    if (openKey === '/') return;
    const timer = setTimeout(() => recheck.current(), OPEN_QUIET_MS + 20);
    return () => clearTimeout(timer);
  }, [openKey]);
  const menuFrom = menu?.fromId;
  useEffect(() => {
    if (!menuFrom) return;
    menuRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    const onDown = (event: PointerEvent) => {
      const t = event.target as Element;
      if (!menuRef.current?.contains(t) && !t.closest?.('[data-handoff]')) setMenu(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menuFrom]);
  const teamMenuId = teamMenu?.teamId;
  useEffect(() => {
    if (!teamMenuId) return;
    teamMenuRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    const onDown = (event: PointerEvent) => {
      const t = event.target as Element;
      if (!teamMenuRef.current?.contains(t) && !t.closest?.('[data-teammenu]')) setTeamMenu(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [teamMenuId]);
  const [viewMenu, setViewMenu] = useState(false);
  const viewRef = useRef<HTMLSpanElement>(null);
  // A menu opened with the mouse gives the focus back to its button without a ring, even on Esc.
  const viewByPointer = useRef(false);
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
      const btn = viewRef.current?.querySelector<HTMLElement>('.view-btn');
      if (!inside || !btn) return;
      if (viewByPointer.current) btn.dataset.quiet = '';
      btn.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [viewMenu]);
  const legendOpen = !!props.onLegend && props.legend === true;
  const barRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const legendBtn = useRef<HTMLButtonElement>(null);
  const legendId = `legend-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // The pop hangs above the controls and gets the room between them and the top of the visible
  // graph (on a phone, below the sticky top bar), scrolling inside when that is short. A drawer
  // moves the controls without a resize, so every render measures again.
  const fitLegend = useCallback(() => {
    const bar = barRef.current;
    const pop = legendRef.current;
    if (!bar || !pop) return;
    const box = bar.getBoundingClientRect();
    const area = (bar.closest('.gcanvas') ?? bar.parentElement)!.getBoundingClientRect();
    const stickyTop =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tk-top')) || 0;
    const top = Math.max(area.top, stickyTop, 0);
    const room = Math.floor(box.top - 8 - top);
    const h = `${Math.max(0, room)}px`;
    const w = `${Math.max(0, Math.floor(box.right - Math.max(area.left, 0) - 12))}px`;
    pop.toggleAttribute('data-no-room', room < LEGEND_MIN_ROOM);
    if (pop.style.getPropertyValue('--lg-room-h') !== h) pop.style.setProperty('--lg-room-h', h);
    if (pop.style.getPropertyValue('--lg-room-w') !== w) pop.style.setProperty('--lg-room-w', w);
  }, []);
  useLayoutEffect(fitLegend);
  // On a phone the page scrolls under the sticky controls, so the first change of a change request
  // would open under them. Until the person scrolls or touches the page, every new layout (the saved
  // fold loads after the first one) places the change above the bar again.
  const touched = useRef(false);
  const placedAt = useRef<number | null>(null);
  const pageChecked = useRef(false);
  useEffect(() => {
    const stop = () => {
      touched.current = true;
    };
    // A scroll before hydration and the scroll that Back restores belong to the person. The check
    // runs once, as a remount (Strict Mode, for one) finds the page's own scroll.
    if (!pageChecked.current) {
      pageChecked.current = true;
      const nav = performance.getEntriesByType('navigation')[0] as
        PerformanceNavigationTiming | undefined;
      if (window.scrollY > 2 || nav?.type === 'back_forward') stop();
    }
    const onScroll = () => {
      if (placedAt.current === null || Math.abs(window.scrollY - placedAt.current) > 2) stop();
    };
    const kinds = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    for (const kind of kinds) window.addEventListener(kind, stop, { capture: true, passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      for (const kind of kinds) window.removeEventListener(kind, stop, { capture: true });
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  useEffect(() => {
    const bar = barRef.current;
    if (touched.current || !bar || !L.rows.length) return;
    if (!window.matchMedia('(max-width: 760px)').matches) return;
    const target = changeInView(root.current, bar, head.current);
    if (target === null) return;
    const first = placedAt.current === null;
    if (first && target <= window.scrollY) {
      placedAt.current = window.scrollY;
      return;
    }
    if (Math.abs(window.scrollY - target) > 1) window.scrollTo(0, target);
    placedAt.current = window.scrollY;
  }, [L]);
  useEffect(() => {
    if (!legendOpen) return;
    const bar = barRef.current;
    const sizes = new ResizeObserver(fitLegend);
    sizes.observe(bar?.closest('.gcanvas') ?? document.body);
    if (bar) sizes.observe(bar);
    window.addEventListener('resize', fitLegend);
    document.addEventListener('scroll', fitLegend, { capture: true, passive: true });
    return () => {
      sizes.disconnect();
      window.removeEventListener('resize', fitLegend);
      document.removeEventListener('scroll', fitLegend, { capture: true });
    };
  }, [legendOpen, fitLegend]);
  const closeLegend = (refocus: boolean) => {
    props.onLegend?.(false);
    if (refocus) legendBtn.current?.focus();
  };
  // Label text measures differ by glyph, so a clip keeps a long label off the buttons.
  const clipId = `labels-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const sideW = L.side;
  const narrow = sideW < SIDE;
  const labelEnd = narrow ? sideW - 4 : X0 - (props.onFocusItem ? 54 : 36);
  const focusItem = narrow ? undefined : props.onFocusItem;
  const focusTeam = narrow ? undefined : props.onFocusTeam;

  const run = (target: Element) => {
    const el = target.closest<SVGElement>(TARGETS);
    const d = el?.dataset;
    if (d?.teamsum) return props.onCollapse?.(d.teamsum);
    if (d?.teammenu && el) return toggleTeamMenu(el, d.teammenu);
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
      viewBox={`0 0 ${sideW} ${TOP}`}
      width={sideW}
      style={{ height: TOP }}
      preserveAspectRatio="xMinYMin slice"
      role="group"
      aria-label="Milestones"
      {...svgProps}
    >
      <text className="lane-name" x={12} y={narrow && edit ? AXIS_Y + 4 : TRUNK_Y + 4}>
        MILESTONES
      </text>
      {edit && (
        <g
          className="pill"
          data-newms="1"
          transform={`translate(${narrow ? 12 : 112} ${TRUNK_Y - 8})`}
          {...button('New milestone')}
        >
          <rect width={104} height={16} rx={8} />
          <text x={52} y={11.5} textAnchor="middle">
            + New milestone
          </text>
        </g>
      )}
      <line className="divider" x1={sideW - 0.5} x2={sideW - 0.5} y1={0} y2={TOP} />
    </svg>
  );

  const side = (
    <svg
      className="tg pg-side"
      viewBox={`0 ${TOP} ${sideW} ${BODY}`}
      width={sideW}
      // Until the phone flag arrives, CSS already narrows a wide view box; slice keeps the scale and crops it.
      style={{ height: BODY }}
      preserveAspectRatio="xMinYMin slice"
      role="group"
      aria-label="Teams and work items"
      {...svgProps}
    >
      {bands(0, sideW)}
      <clipPath id={clipId}>
        <rect x={0} y={0} width={labelEnd} height={H} />
      </clipPath>
      {L.lanes.map((lane) => {
        const { summary, top, head } = lane;
        const dense = head < 28;
        // Capitals are about 7.6 units tall, so a baseline 3.8 below the centre centres the name.
        const line1 = top + head / 2 + 3.8;
        const btn = dense ? lv.btn : 16;
        const icon = dense ? lv.btnIcon : 11;
        const by = top + head / 2 - btn / 2;
        // An empty team has nothing to open or collapse, so its summary is plain text.
        const toggles = summary.count > 0;
        return (
          <Fragment key={lane.teamId}>
            {narrow ? (
              <rect
                className="sum-hit"
                data-teammenu={lane.teamId}
                x={0.5}
                y={top + 0.5}
                width={sideW - 1}
                height={head - 1}
                aria-haspopup="menu"
                aria-expanded={teamMenu?.teamId === lane.teamId}
                {...button(`${summary.ariaLabel}${lane.collapsed ? ', collapsed' : ''}`)}
              >
                <title>{`${summary.ariaLabel}. Team actions`}</title>
              </rect>
            ) : toggles ? (
              <rect
                className="sum-hit"
                data-teamsum={lane.teamId}
                x={0.5}
                y={top + 0.5}
                width={sideW - 1}
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
              {lane.label !== lane.name.normalize('NFC').toUpperCase() && (
                <title>{lane.name}</title>
              )}
            </text>
            {focusTeam && (
              <g
                className={cls('eye', 'focus-btn', lane.focused && 'on')}
                data-focusteam={lane.teamId}
                aria-pressed={lane.focused}
                {...button(lane.focusLabel)}
              >
                <rect x={X0 - 43 - btn / 2} y={by} width={btn} height={btn} rx={4} />
                <SvgIcon name="focus" x={X0 - 43} y={by + btn / 2} size={icon} />
                <title>
                  {lane.focused ? 'Leave focus' : 'Focus: show only this team and the work from it'}
                </title>
              </g>
            )}
            {!narrow && (
              <g className="eye" data-eyeteam={lane.teamId} {...button(lane.eyeLabel)}>
                <rect x={X0 - 24 - btn / 2} y={by} width={btn} height={btn} />
                <SvgIcon name="eye" x={X0 - 24} y={by + btn / 2} size={icon} />
              </g>
            )}
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
              width={sideW - 22}
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
              width={narrow ? sideW - 30 : X0 - (props.onFocusItem ? 82 : 64)}
              height={Math.min(20, lv.hit)}
            >
              <title>
                {edit ? 'Open the details, or drag onto a milestone to add it' : 'Open the details'}
              </title>
            </rect>
            {focusItem && (
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
            {!narrow && (
              <g className="eye" data-eyerow={r.id} {...button(r.eyeLabel)}>
                <rect
                  x={X0 - 24 - lv.btn / 2}
                  y={r.y - lv.btn / 2}
                  width={lv.btn}
                  height={lv.btn}
                />
                <SvgIcon name="eye" x={X0 - 24} y={r.y} size={lv.btnIcon} />
              </g>
            )}
          </Fragment>
        );
      })}
      <line className="divider" x1={sideW - 0.5} x2={sideW - 0.5} y1={TOP} y2={H} />
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
      ref={headSvg}
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
      {/* One layer under every milestone, so no name box covers a circle. */}
      <g className="label-backs">
        {L.milestones.map((m) => (
          <rect key={m.id} className="label-back" data-back={m.id} />
        ))}
      </g>
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
              {d.label && (
                <text
                  className="deadline-name deadline-stuck"
                  y={d.labelY - d.y}
                  style={{
                    fill: ink(d.tone === 'ink-3' ? 'ink-2' : d.tone),
                    fontSize: lv.nameFont,
                  }}
                />
              )}
            </g>
          ))}
          {(events.get(r.id) ?? []).map((g) => {
            const n = g.eventIds.length;
            // Kinds colour the events; the row line keeps the status colour.
            const stroke = KIND_COLOR[g.kind];
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
                <g style={{ ['--kc' as string]: stroke }}>
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
                        style={{ stroke, strokeWidth: dots ? 1 : undefined }}
                      />
                    ))}
                  {dots ? (
                    <circle className="dot" r={lv.r} style={{ fill: stroke }} />
                  ) : (
                    <>
                      <circle className="bg" r={lv.r} style={{ stroke }} />
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

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>, close: (refocus: boolean) => void) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button'));
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = items[(at + step + items.length) % items.length];
      if (!next) return;
      // A focus scroll would move the page, and the page scroll closes the menu.
      next.focus({ preventScroll: true });
      const list = event.currentTarget;
      if (next.offsetTop < list.scrollTop) list.scrollTop = next.offsetTop;
      else if (next.offsetTop + next.offsetHeight > list.scrollTop + list.clientHeight)
        list.scrollTop = next.offsetTop + next.offsetHeight - list.clientHeight;
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
            <div className="lane-counts" aria-hidden="true" style={timeWidth}>
              {L.lanes.map((lane) => {
                const parts = laneCounts(lane.summary);
                return parts.length ? (
                  <div
                    key={lane.teamId}
                    className="lane-count"
                    style={{ top: lane.top - TOP, height: lane.head }}
                  >
                    <span>
                      {parts.map((p, i) => (
                        <Fragment key={p.word}>
                          {i ? ' · ' : ''}
                          <span className={p.cls}>
                            {p.n} {p.word}
                          </span>
                        </Fragment>
                      ))}
                    </span>
                  </div>
                ) : null;
              })}
            </div>
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
          className={`hand-menu ${menu.align}${menu.place?.up ? ' up' : ''}`}
          role="menu"
          aria-label={`Handoffs from ${L.rows.find((r) => r.id === menu.fromId)?.title ?? ''}`}
          style={menuStyle(menu)}
          onKeyDown={(event) => onMenuKey(event, closeMenu)}
          onBlur={(event) => {
            const to = event.relatedTarget as Element | null;
            // A press on a mark moves the focus there first; its click then closes or switches the list.
            if (!menuRef.current?.contains(to) && !to?.closest('[data-handoff]')) setMenu(null);
          }}
        >
          <p>
            {menuMark.cancelled
              ? 'Cancelled, no longer hands over to'
              : menuMark.wait
                ? 'Hands over when done to'
                : 'Handed over to'}
          </p>
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
      {teamMenu && teamMenuLane && (
        <div
          ref={teamMenuRef}
          className={`hand-menu team-menu start${teamMenu.place?.up ? ' up' : ''}`}
          role="menu"
          aria-label={teamMenuLane.name}
          style={menuStyle(teamMenu)}
          onKeyDown={(event) => onMenuKey(event, closeTeamMenu)}
          onBlur={(event) => {
            const to = event.relatedTarget as Element | null;
            if (!teamMenuRef.current?.contains(to) && !to?.closest('[data-teammenu]'))
              setTeamMenu(null);
          }}
        >
          <p>{teamMenuLane.name}</p>
          {teamMenuItems({
            name: teamMenuLane.name,
            count: teamMenuLane.summary.count,
            collapsed: teamMenuLane.collapsed,
            focused: teamMenuLane.focused,
          })
            .filter(
              (i) =>
                (i.action !== 'collapse' || props.onCollapse) &&
                (i.action !== 'focus' || props.onFocusTeam),
            )
            .map((i) => (
              <button
                key={i.action}
                type="button"
                role="menuitem"
                aria-label={i.label}
                onClick={() => {
                  const teamId = teamMenuLane.teamId;
                  // The Focus panel gives the focus back to the team name when it closes.
                  closeTeamMenu(i.action !== 'hide');
                  if (i.action === 'collapse') props.onCollapse?.(teamId);
                  else if (i.action === 'focus') props.onFocusTeam?.(teamId);
                  else {
                    hiddenByMenu.current = true;
                    props.onToggleTeam(teamId);
                  }
                }}
              >
                <b>{i.text}</b>
              </button>
            ))}
        </div>
      )}
      <div className="zoombar" role="group" aria-label="View controls" ref={barRef}>
        {props.onLegend && (
          <button
            ref={legendBtn}
            type="button"
            className="lg-btn"
            aria-label="Legend"
            title="Legend"
            aria-expanded={legendOpen}
            aria-controls={legendId}
            onClick={() => props.onLegend?.(!legendOpen)}
          >
            <Icon name="legend" size={14} />
          </button>
        )}
        {legendOpen && (
          <div
            ref={legendRef}
            id={legendId}
            className="legend-pop"
            role="dialog"
            aria-label="Legend"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              closeLegend(true);
            }}
          >
            <LegendBody onClose={() => closeLegend(true)} />
          </div>
        )}
        {props.onDensity && (
          <span className="view-menu" ref={viewRef}>
            <button
              type="button"
              className="view-btn"
              aria-label="Row height and teams"
              title="Row height and teams"
              aria-expanded={viewMenu}
              aria-controls={viewId}
              onClick={(event) => {
                viewByPointer.current = event.detail > 0;
                setViewMenu((open) => !open);
              }}
              onBlur={(event) => delete event.currentTarget.dataset.quiet}
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

const LINES: Array<{ tone: string; label: string; title?: string }> = [
  { tone: 'var(--route)', label: 'Not finished' },
  { tone: 'var(--proceed)', label: 'Done' },
  { tone: 'var(--danger)', label: 'Late part', title: 'Not finished after its planned finish' },
  { tone: 'var(--caution)', label: 'Done late', title: 'Done after its planned finish' },
  { tone: 'var(--isolated)', label: 'Cancelled' },
];
// The legend reads in the order of the kind picker (start, progress, finish).
const LEGEND_KINDS = KIND_GROUPS.flatMap((g) => g.kinds);
const MILESTONE_SHORT: Partial<Record<Status, string>> = { early: 'Early', ontime: 'On time' };

function LegendKind({ kind }: { kind: EventKind }) {
  return (
    <span className="lg-it lg-kd">
      <span className="lg-ring" style={{ color: KIND_COLOR[kind] }}>
        <KindIcon kind={kind} size={11} />
      </span>
      {KIND_LABEL[kind]}
    </span>
  );
}

function LegendBody({ onClose }: { onClose: () => void }) {
  const half = Math.ceil(LEGEND_KINDS.length / 2);
  return (
    <>
      <button className="x lg-x" type="button" aria-label="Close legend" onClick={onClose}>
        ×
      </button>
      <div className="lg-grid">
        <div className="lg-sec">
          <p className="q-label">Line</p>
          {LINES.map((l) => (
            <span key={l.label} className="lg-it" title={l.title}>
              <i className="ln" style={{ background: l.tone }} />
              {l.label}
            </span>
          ))}
          <p className="q-label">Change</p>
          <span className="lg-it" title="Changed in this change request">
            <i className="chg">Name</i>
            Changed here
          </span>
        </div>
        <div className="lg-sec">
          <p className="q-label">Milestone</p>
          <span className="lg-it" title="Milestone deadline on its work items">
            <svg width="12" height="12" viewBox="-7 -7 14 14" aria-hidden="true">
              <path d={DIAMOND} fill="var(--ink-3)" stroke="var(--ink-3)" strokeWidth="1.5" />
            </svg>
            Deadline
          </span>
          {MILESTONE_STATUSES.map((status) => (
            <span
              key={status}
              className="lg-it"
              title={MILESTONE_SHORT[status] && STATUS_LABEL[status]}
            >
              <i
                className={cls('ms-sw', status !== 'planned' && 'fill')}
                style={{ color: color(STATUS_TONE[status]) }}
              />
              {MILESTONE_SHORT[status] ?? STATUS_LABEL[status]}
            </span>
          ))}
        </div>
        <div className="lg-sec lg-ev" role="group" aria-label="Event kinds">
          <p className="q-label">Event</p>
          <div className="lg-ev-cols">
            {[LEGEND_KINDS.slice(0, half), LEGEND_KINDS.slice(half)].map((kinds) => (
              <div key={kinds[0]} className="lg-sec">
                {kinds.map((kind) => (
                  <LegendKind key={kind} kind={kind} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
