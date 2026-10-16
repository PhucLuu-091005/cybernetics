'use client';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  GEOMETRY,
  STATUS_LABEL,
  STATUS_TONE,
  type Curve,
  type LayoutMilestone,
  type Tone,
  type TrackerLayout,
} from '../../tracker';
import { svgPoint } from './drag';
import { Icon, SvgIcon } from './icons';

const { VW, X0, SIDE, AXIS_Y, TRUNK_Y, MAX_ZOOM } = GEOMETRY;
// The bin floats over the bottom of the graph, so the New team pill needs room above it.
const TEAM_PILL_ROOM = 28;
const ZOOM_STEP = 1.5;
const REVEAL_ZOOM = 2;
const REVEAL_FLASH_MS = 1500;
const REVEAL_PAD = 40;

export type PopKind = 'act' | 'loop' | 'stack';
export type DatePreview = { kind: 'item' | 'ms'; id: string; x: number; label?: string };
/** A new key asks the graph to bring the row into view again, even for the same row. */
export type Reveal = { rowId: string; key: number };

type Props = {
  layout: TrackerLayout;
  edit: boolean;
  selectedMs: string | null;
  flash: string | null;
  focusRow?: string | null;
  focusMs?: string | null;
  lifted?: string | null;
  preview?: DatePreview | null;
  /** While an event waits for its new work item, a click on a row picks that row. */
  moving?: boolean;
  reveal?: Reveal | null;
  onZoom: (zoom: number) => void;
  onMoveTo?: (workItemId: string | null) => void;
  onToggleRow: (workItemId: string) => void;
  onToggleTeam: (teamId: string) => void;
  onReveal: (workItemIds: string[]) => void;
  onPop: (kind: PopKind, id: string, anchor: Element) => void;
  onMilestone: (milestoneId: string) => void;
  onAddEvent: (workItemId: string) => void;
  onNewMilestone: () => void;
  onNewTeam: () => void;
  onBackground: () => void;
};

const color = (tone: Tone) => `var(--${tone})`;
const path = ({ from, c1, c2, to }: Curve) =>
  `M${from.x} ${from.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`;
const cls = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');
const share = (part: number, whole: number) => `${(100 * part) / whole}%`;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(1, z));

function groupBy<T extends { workItemId: string }>(list: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const x of list) map.set(x.workItemId, [...(map.get(x.workItemId) ?? []), x]);
  return map;
}

const TARGETS =
  '[data-eyerow],[data-eyeteam],[data-show],[data-act],[data-ms],[data-goal],[data-plus],[data-newms],[data-newteam],[data-rowlabel],[data-loop]';
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
  const events = groupBy(L.eventGroups);
  const goals = groupBy(L.goalTicks);
  const chips = groupBy(L.chips);
  const xt = L.tLine.x;
  const H = L.height + (edit ? TEAM_PILL_ROOM : 0);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const timeSvg = useRef<SVGSVGElement>(null);
  const latest = useRef({ L, onZoom: props.onZoom, onBackground: props.onBackground });
  useLayoutEffect(() => {
    latest.current = { L, onZoom: props.onZoom, onBackground: props.onBackground };
  });

  // Wheel events can arrive faster than renders, so the next zoom builds on the one still pending.
  const anchor = useRef<{ zoom: number; t: number; clientX: number } | null>(null);
  /** A factor of 0 fits the window to the width again. */
  const zoomBy = useCallback((factor: number, clientX?: number) => {
    const { L: now, onZoom, onBackground } = latest.current;
    const el = scroller.current;
    const svg = timeSvg.current;
    const from = anchor.current?.zoom ?? now.zoom;
    const zoom = clampZoom(from * factor);
    if (!el || !svg || zoom === from) return;
    const box = el.getBoundingClientRect();
    const cx =
      clientX === undefined
        ? box.left + box.width / 2
        : Math.min(box.right, Math.max(box.left, clientX));
    const t = anchor.current?.t ?? now.t(svgPoint(svg, cx, box.top).x);
    anchor.current = { zoom, t, clientX: anchor.current?.clientX ?? cx };
    // A pop stays where its anchor was, so it closes before the anchor moves.
    onBackground();
    onZoom(zoom);
  }, []);
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scroller.current;
    const svg = timeSvg.current;
    if (!a || !el || !svg || a.zoom !== L.zoom) return;
    anchor.current = null;
    const scale = svg.getBoundingClientRect().width / (L.width - SIDE);
    el.scrollLeft = (L.x(a.t) - SIDE) * scale - (a.clientX - el.getBoundingClientRect().left);
  }, [L]);

  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      zoomBy(Math.exp(-event.deltaY * unit * 0.002), event.clientX);
    };
    // React registers wheel listeners as passive, and a passive listener cannot stop the page zoom.
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

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
    if (latest.current.L.zoom > 1) return showRow(target);
    pendingReveal.current = target;
    latest.current.onZoom(REVEAL_ZOOM);
  }, [revealKey, revealRow, showRow]);
  useLayoutEffect(() => {
    const target = pendingReveal.current;
    if (!target || L.zoom === 1) return;
    pendingReveal.current = null;
    showRow(target);
  }, [L, showRow]);
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setRevealed(null), REVEAL_FLASH_MS);
    return () => clearTimeout(timer);
  }, [revealed]);
  const flash = revealed?.id ?? props.flash;

  const run = (target: Element) => {
    const el = target.closest<SVGElement>(TARGETS);
    const d = el?.dataset;
    if (d?.eyerow) return props.onToggleRow(d.eyerow);
    if (d?.eyeteam) return props.onToggleTeam(d.eyeteam);
    if (d?.show) return props.onReveal(d.show.split(','));
    // In move mode the graph background and any other target end the move, as in the prototype.
    if (props.moving) {
      const row = target.closest<SVGElement>(ROWS)?.dataset;
      return props.onMoveTo?.(
        row ? (row.loop ?? row.in ?? row.rowlabel ?? row.plus ?? null) : null,
      );
    }
    if (!el || !d) return props.onBackground();
    if (d.act) return props.onPop(d.stack ? 'stack' : 'act', d.stack ?? d.act, el);
    if (d.ms) return props.onMilestone(d.ms);
    if (d.goal) return props.onMilestone(d.goal);
    if (d.plus) return props.onAddEvent(d.plus);
    if (d.newms) return props.onNewMilestone();
    if (d.newteam) return props.onNewTeam();
    if (d.rowlabel) {
      const row = root.current?.querySelector(`svg.pg [data-loop="${d.rowlabel}"]`);
      return props.onPop('loop', d.rowlabel, row ?? el);
    }
    if (d.loop) return props.onPop('loop', d.loop, el);
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
  const rowCls = (id: string) => cls(focusRow === id && 'focus', flash === id && 'flash');
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

  const side = (
    <svg
      className="tg pg-side"
      viewBox={`0 0 ${SIDE} ${H}`}
      style={{ width: share(SIDE, VW) }}
      role="group"
      aria-label="Teams and work items"
      {...svgProps}
    >
      {bands(0, SIDE)}
      {L.lanes.map((lane) => (
        <Fragment key={lane.teamId}>
          <g
            className={cls('eye', lane.hidden && 'off')}
            data-eyeteam={lane.teamId}
            {...button(lane.eyeLabel)}
          >
            <rect x={X0 - 34} y={lane.top + 2} width={20} height={18} />
            <SvgIcon
              name={lane.hidden ? 'eyeoff' : 'eye'}
              x={X0 - 24}
              y={lane.top + 11}
              size={13}
            />
          </g>
          <text className="lane-name" x={12} y={lane.top + 15}>
            {lane.label}
            {lane.label !== lane.name.toUpperCase() && <title>{lane.name}</title>}
          </text>
          {lane.more && (
            <g
              className="more"
              data-show={lane.more.ids.join(',')}
              transform={`translate(${lane.more.x} ${lane.top + 4})`}
              {...button(lane.more.ariaLabel)}
            >
              <rect width={lane.more.width} height={14} rx={7} />
              <text x={lane.more.width / 2} y={10} textAnchor="middle">
                {lane.more.text}
              </text>
            </g>
          )}
          {lane.guide && (
            <line className="guide" x1={16} x2={16} y1={lane.guide.y1} y2={lane.guide.y2} />
          )}
        </Fragment>
      ))}
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
      {edit && (
        <g
          className="pill"
          data-newteam="1"
          transform={`translate(12 ${(L.lanes.at(-1)?.bottom ?? TRUNK_Y + 16) + 6})`}
          {...button('New team')}
        >
          <rect width={84} height={16} rx={8} />
          <text x={42} y={11.5} textAnchor="middle">
            + New team
          </text>
        </g>
      )}
      {L.rows.map((r) => (
        <Fragment key={`side-${r.id}`}>
          <rect
            className={cls('hit', rowCls(r.id))}
            data-rowlabel={r.id}
            x={22}
            y={r.y - 15}
            width={SIDE - 22}
            height={30}
          />
          <line className="guide" x1={16} x2={24} y1={r.y} y2={r.y} />
          <text
            className={cls(
              'row-label',
              r.changed && 'changed',
              selectedMs && r.milestoneId === selectedMs && 'sel',
            )}
            x={28}
            y={r.y + 4}
          >
            {r.label}
            <title>{r.title}</title>
          </text>
          <rect
            className="label-hit"
            data-rowlabel={r.id}
            x={26}
            y={r.y - 10}
            width={X0 - 64}
            height={20}
          >
            {edit && <title>Drag onto a milestone to add it</title>}
          </rect>
          <g className="eye" data-eyerow={r.id} {...button(r.eyeLabel)}>
            <rect x={X0 - 33} y={r.y - 9} width={18} height={18} />
            <SvgIcon name="eye" x={X0 - 24} y={r.y} size={12} />
          </g>
        </Fragment>
      ))}
      <line className="divider" x1={SIDE - 0.5} x2={SIDE - 0.5} y1={0} y2={H} />
    </svg>
  );

  const time = (
    <svg
      ref={timeSvg}
      className="tg pg"
      viewBox={`${SIDE} 0 ${L.width - SIDE} ${H}`}
      style={{ width: share(L.width - SIDE, VW - SIDE - L.rail) }}
      role="group"
      aria-label={L.window.label}
      {...svgProps}
    >
      {bands(SIDE, L.width - SIDE)}
      {L.ticks.map((tick) => (
        <Fragment key={tick.date}>
          <line className="grid" x1={tick.x} x2={tick.x} y1={TRUNK_Y} y2={L.height} />
          {tick.labelled && (
            <text className="tick" x={tick.x} y={AXIS_Y}>
              {tick.label}
            </text>
          )}
        </Fragment>
      ))}
      <line className="tline" x1={xt} x2={xt} y1={L.tLine.y1} y2={L.tLine.y2} />
      <g className="tpill">
        <rect x={xt - 44} y={AXIS_Y - 12} width={88} height={17} rx={8.5} />
        <text x={xt} y={AXIS_Y}>
          {L.tLine.label}
        </text>
      </g>
      {L.stems.map((s) => (
        <path
          key={`stem-${s.workItemId}`}
          className="stem"
          d={`M${s.x} ${s.y1} L${s.x} ${s.y2}`}
          style={{ stroke: color(s.tone) }}
        />
      ))}
      {L.segments.map((s, i) =>
        s.kind === 'wait' ? (
          <Fragment key={`wait-${s.workItemId}`}>
            <line className="wait-line" x1={s.x1} x2={s.x2} y1={s.y} y2={s.y} />
            <text className="wait-text" x={s.textX} y={s.textY}>
              {s.text}
            </text>
          </Fragment>
        ) : (
          <line
            key={`seg-${s.workItemId}-${i}`}
            className="seg"
            x1={s.x1}
            x2={s.x2}
            y1={s.y}
            y2={s.y}
            style={{ stroke: color(s.tone) }}
          />
        ),
      )}
      {L.links.map((link) => (
        <path
          key={`link-${link.fromId}-${link.toId}`}
          className={cls('link', link.wait && 'wait')}
          d={path(link)}
          style={{ stroke: color(link.tone) }}
        />
      ))}
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
      {L.rows.map((r) => (
        <Fragment key={`row-${r.id}`}>
          <rect
            className={cls('hit', rowCls(r.id))}
            data-loop={r.id}
            x={SIDE}
            y={r.y - 15}
            width={L.width - SIDE}
            height={30}
            {...button(`${r.title}, ${STATUS_LABEL[r.status]}`)}
          />
          {(goals.get(r.id) ?? []).map((g) => (
            <g
              key={`goal-${g.workItemId}`}
              className="goal"
              data-goal={g.milestoneId}
              transform={`translate(${g.x} ${g.y})`}
              {...button(g.ariaLabel)}
            >
              <rect className="goal-hit" x={-8} y={-15} width={16} height={30} />
              <path
                className="goal-bar"
                d="M0 -9 V9"
                style={{ stroke: color(g.changed ? 'change' : g.tone) }}
              />
              <text
                className="goal-date"
                x={g.dateAnchor === 'end' ? -6 : 6}
                y={-6}
                textAnchor={g.dateAnchor}
                style={{ fill: color(g.tone) }}
              >
                {g.dateLabel}
              </text>
              <title>{g.tooltip}</title>
            </g>
          ))}
          {(events.get(r.id) ?? []).map((g) => {
            const n = g.eventIds.length;
            const stroke = color(g.tone);
            return (
              <g
                key={g.topId}
                className={cls('act', lifted === g.topId && 'lift')}
                data-act={g.topId}
                data-stack={n > 1 ? g.eventIds.join(',') : undefined}
                data-in={g.workItemId}
                transform={`translate(${g.x} ${g.y})`}
                {...button(g.ariaLabel)}
              >
                <g>
                  {g.changed && <circle className="halo" r={15} />}
                  {[2, 1]
                    .filter((k) => k <= n - 1)
                    .map((k) => (
                      <circle
                        key={k}
                        className="layer"
                        cx={-3.5 * k}
                        r={10}
                        style={{
                          stroke,
                          fill: `color-mix(in srgb, ${stroke} 18%, var(--panel))`,
                        }}
                      />
                    ))}
                  <circle className="bg" r={10} style={{ stroke }} />
                  <SvgIcon kind={g.kind} x={0} y={0} size={13} color={stroke} />
                  <title>{g.tooltip}</title>
                </g>
              </g>
            );
          })}
          {edit && !r.done && (
            <g
              className="plus"
              data-plus={r.id}
              transform={`translate(${xt + 20} ${r.y})`}
              {...button(`Add an event to ${r.title}`)}
            >
              <circle r={9} />
              <path d="M-4 0h8M0 -4v8" />
              <title>{`Add an event to ${r.title}`}</title>
            </g>
          )}
          {(chips.get(r.id) ?? []).map((c) => (
            <g
              key={`chip-${c.workItemId}`}
              className="chip"
              data-show={c.sources.join(',')}
              transform={`translate(${c.x} ${c.y})`}
              {...button(c.ariaLabel)}
            >
              <rect width={c.size} height={c.size} rx={4} />
              <SvgIcon name="branch" x={c.size / 2} y={c.size / 2} size={10} />
              <title>{c.tooltip}</title>
            </g>
          ))}
        </Fragment>
      ))}
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
      {L.milestones.map((m) => {
        const moved = preview?.kind === 'ms' && preview.id === m.id ? preview : null;
        const mx = moved ? moved.x : m.x;
        return (
          <g
            key={m.id}
            className={cls('ms', selectedMs === m.id && 'sel', focusMs === m.id && 'glow')}
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
              style={m.changed ? undefined : { fill: color(m.labelTone) }}
            >
              {moved?.label ?? m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );

  const rail = L.rail > 0 && (
    <svg
      className="tg pg-rail"
      viewBox={`0 0 ${L.rail} ${H}`}
      style={{ width: share(L.rail, VW) }}
      role="group"
      aria-label="Milestones of the work items"
      {...svgProps}
    >
      {bands(0, L.rail)}
      {L.rows.map((r) => (
        <rect
          key={`rail-${r.id}`}
          className={cls('hit', 'rail-row', rowCls(r.id))}
          x={0}
          y={r.y - 15}
          width={L.rail}
          height={30}
        />
      ))}
      <line className="divider" x1={0.5} x2={0.5} y1={0} y2={H} />
      {L.msChips.map((c) => (
        <g
          key={`ms-chip-${c.workItemId}`}
          className={cls(
            'ms-chip',
            c.tone === 'ink-2' && 'calm',
            selectedMs === c.milestoneId && 'sel',
          )}
          data-goal={c.milestoneId}
          transform={`translate(${c.x} ${c.y})`}
          style={{ color: color(c.tone) }}
          {...button(c.ariaLabel)}
        >
          <rect width={c.width} height={c.height} rx={7} />
          <text x={c.width / 2} y={10} textAnchor="middle">
            {c.text}
          </text>
          <title>{c.tooltip}</title>
        </g>
      ))}
    </svg>
  );

  return (
    <div className={cls('tgraph', edit && 'editable')} ref={root}>
      <div className="gscroll">
        <div className="gframe" ref={frame}>
          {side}
          <div className="gtime" ref={scroller}>
            {time}
          </div>
          {rail}
        </div>
      </div>
      <div className="zoombar" role="group" aria-label="Time zoom">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={L.zoom <= 1}
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
          disabled={L.zoom >= MAX_ZOOM}
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          <Icon name="plus" size={14} />
        </button>
        <button
          type="button"
          className="fit"
          aria-label="Fit to width"
          disabled={L.zoom === 1}
          onClick={() => zoomBy(0)}
        >
          Fit
        </button>
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
      {line('var(--route)', 'Open')}
      {line('var(--proceed)', 'Done')}
      {line('var(--danger)', 'Open after its planned finish')}
      {line('var(--caution)', 'Done after its planned finish')}
      <span>
        <svg width="6" height="14" viewBox="0 0 6 14" aria-hidden="true">
          <path d="M3 2V12" stroke="var(--ink-2)" strokeWidth="3" strokeLinecap="round" />
        </svg>
        Milestone date on its work items
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
    </div>
  );
}
