'use client';
import { Fragment, type KeyboardEvent, type MouseEvent } from 'react';
import {
  GEOMETRY,
  STATUS_LABEL,
  STATUS_TONE,
  type Curve,
  type Tone,
  type TrackerLayout,
} from '../../tracker';
import { SvgIcon } from './icons';

const { VW, X0, X1, AXIS_Y, TRUNK_Y } = GEOMETRY;

export type PopKind = 'act' | 'loop' | 'due';
export type DatePreview = { kind: 'item' | 'ms'; id: string; x: number; label?: string };

type Props = {
  layout: TrackerLayout;
  edit: boolean;
  selectedMs: string | null;
  flash: string | null;
  focusRow?: string | null;
  focusMs?: string | null;
  dimmed: (workItemId: string) => boolean;
  lifted?: string | null;
  preview?: DatePreview | null;
  /** While an event waits for its new work item, a click on a row picks that row. */
  moving?: boolean;
  onMoveTo?: (workItemId: string | null) => void;
  onToggleRow: (workItemId: string) => void;
  onToggleTeam: (teamId: string) => void;
  onReveal: (workItemIds: string[]) => void;
  onPop: (kind: PopKind, id: string, anchor: Element) => void;
  onMilestone: (milestoneId: string) => void;
  onAddEvent: (workItemId: string) => void;
  onNewMilestone: () => void;
  onBackground: () => void;
};

const color = (tone: Tone) => `var(--${tone})`;
const path = ({ from, c1, c2, to }: Curve) =>
  `M${from.x} ${from.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`;
const cls = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

function groupBy<T extends { workItemId: string }>(list: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const x of list) map.set(x.workItemId, [...(map.get(x.workItemId) ?? []), x]);
  return map;
}

const TARGETS =
  '[data-eyerow],[data-eyeteam],[data-show],[data-due],[data-act],[data-ms],[data-plus],[data-newms],[data-rowlabel],[data-loop]';
const ROWS = '[data-loop],[data-act],[data-rowlabel],[data-plus]';

export function TrackerGraph(props: Props) {
  const { layout: L, edit, selectedMs, flash, focusRow, focusMs, dimmed, lifted, preview } = props;
  const events = groupBy(L.eventGroups);
  const flags = groupBy(L.flags);
  const slips = groupBy(L.slips);
  const chips = groupBy(L.chips);
  const xt = L.tLine.x;

  const run = (target: Element) => {
    const el = target.closest<SVGElement>(TARGETS);
    const d = el?.dataset;
    if (!el || !d) return props.onBackground();
    if (d.eyerow) return props.onToggleRow(d.eyerow);
    if (d.eyeteam) return props.onToggleTeam(d.eyeteam);
    if (d.show) return props.onReveal(d.show.split(','));
    if (props.moving) {
      const row = target.closest<SVGElement>(ROWS)?.dataset;
      return props.onMoveTo?.(
        row ? (row.loop ?? row.in ?? row.rowlabel ?? row.plus ?? null) : null,
      );
    }
    if (d.due) return props.onPop('due', d.due, el);
    if (d.act) return props.onPop('act', d.act, el);
    if (d.ms) return props.onMilestone(d.ms);
    if (d.plus) return props.onAddEvent(d.plus);
    if (d.newms) return props.onNewMilestone();
    if (d.rowlabel) {
      const row = el.ownerSVGElement?.querySelector(`[data-loop="${d.rowlabel}"]`);
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
  const button = (label: string) => ({ role: 'button', tabIndex: 0, 'aria-label': label });

  return (
    <svg
      className="pg"
      viewBox={`0 0 ${VW} ${L.height}`}
      role="group"
      aria-label={L.window.label}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {L.lanes.map((lane) => (
        <Fragment key={lane.teamId}>
          <rect
            className={cls('lane-band', lane.alt && 'alt')}
            x={0}
            y={lane.top}
            width={VW}
            height={lane.bottom - lane.top}
          />
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
            {lane.name.toUpperCase()}
          </text>
          {lane.guide && (
            <line className="guide" x1={16} x2={16} y1={lane.guide.y1} y2={lane.guide.y2} />
          )}
        </Fragment>
      ))}
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
      <line className="divider" x1={X0 - 8} x2={X0 - 8} y1={0} y2={L.height} />
      <line className="tline" x1={xt} x2={xt} y1={L.tLine.y1} y2={L.tLine.y2} />
      <g className="tpill">
        <rect x={xt - 44} y={AXIS_Y - 12} width={88} height={17} rx={8.5} />
        <text x={xt} y={AXIS_Y}>
          {L.tLine.label}
        </text>
      </g>
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
      {L.stems.map((s) => (
        <path
          key={`stem-${s.workItemId}`}
          className={cls('stem', s.ghost && 'ghost', dimmed(s.workItemId) && 'dim')}
          d={`M${s.x} ${s.y1} L${s.x} ${s.y2}`}
          style={{ stroke: color(s.tone) }}
        />
      ))}
      {L.segments.map((s, i) =>
        s.kind === 'wait' ? (
          <Fragment key={`wait-${s.workItemId}`}>
            <line
              className={cls('wait-line', dimmed(s.workItemId) && 'dim')}
              x1={s.x1}
              x2={s.x2}
              y1={s.y}
              y2={s.y}
            />
            <text
              className={cls('wait-text', dimmed(s.workItemId) && 'dim')}
              x={s.textX}
              y={s.textY}
            >
              {s.text}
            </text>
          </Fragment>
        ) : (
          <line
            key={`seg-${s.workItemId}-${i}`}
            className={cls('seg', dimmed(s.workItemId) && 'dim')}
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
          className={cls(
            'link',
            link.wait && 'wait',
            link.ghost && 'ghost',
            dimmed(link.toId) && 'dim',
          )}
          d={path(link)}
          style={{ stroke: color(link.tone) }}
        />
      ))}
      {L.msLinks.map((link) => (
        <path
          key={`mslink-${link.workItemId}`}
          className={cls(
            'mslink',
            selectedMs === link.milestoneId && 'sel',
            dimmed(link.workItemId) && 'dim',
          )}
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
      {L.folds.map((f) =>
        f.kind === 'team' ? (
          <g
            key={`fold-${f.teamId}`}
            className="fold"
            data-eyeteam={f.teamId}
            {...button(f.ariaLabel)}
          >
            <rect className="strip" x={f.x} y={f.y} width={f.width} height={f.height} rx={4} />
            <text x={f.textX} y={f.textY}>
              {f.text}
            </text>
          </g>
        ) : (
          <g
            key={`fold-${f.workItemId}`}
            className="fold"
            data-eyerow={f.workItemId}
            {...button(f.ariaLabel)}
          >
            <rect className="strip" x={f.x} y={f.y} width={f.width} height={f.height} rx={4} />
            <SvgIcon name="eyeoff" x={f.iconX} y={f.y + f.height / 2} size={10} />
            <text x={f.textX} y={f.textY}>
              {f.text}
            </text>
          </g>
        ),
      )}
      {L.rows
        .filter((r) => r.fold === null)
        .map((r) => {
          const dim = dimmed(r.id) && 'dim';
          return (
            <Fragment key={`row-${r.id}`}>
              <rect
                className={cls('hit', dim, focusRow === r.id && 'focus', flash === r.id && 'flash')}
                data-loop={r.id}
                x={22}
                y={r.y - 15}
                width={X1 - 14}
                height={30}
                {...button(`${r.title}, ${STATUS_LABEL[r.status]}`)}
              />
              <line className="guide" x1={16} x2={24} y1={r.y} y2={r.y} />
              <g className="eye" data-eyerow={r.id} {...button(r.eyeLabel)}>
                <rect x={X0 - 33} y={r.y - 9} width={18} height={18} />
                <SvgIcon name="eye" x={X0 - 24} y={r.y} size={12} />
              </g>
              <text
                className={cls(
                  'row-label',
                  r.draft && 'draft',
                  selectedMs && r.milestoneId === selectedMs && 'sel',
                  dim,
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
                <title>Drag onto a milestone diamond to add it</title>
              </rect>
              {(events.get(r.id) ?? []).map((g) => {
                const n = g.eventIds.length;
                const stroke = color(g.tone);
                return (
                  <g
                    key={g.topId}
                    className={cls('act', dim, lifted === g.topId && 'lift')}
                    data-act={g.topId}
                    data-in={g.workItemId}
                    transform={`translate(${g.x} ${g.y})`}
                    {...button(g.ariaLabel)}
                  >
                    <g>
                      {g.draft && <circle className="halo" r={15} />}
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
              {(slips.get(r.id) ?? []).map((s) => (
                <Fragment key={`slip-${s.workItemId}`}>
                  <line className={cls('slip', dim)} x1={s.x1} x2={s.x2} y1={s.y} y2={s.y} />
                  <path className={cls('slip-o', dim)} d={`M${s.x1} ${s.y - 4} V${s.y + 4}`} />
                </Fragment>
              ))}
              {(flags.get(r.id) ?? []).map((f) => (
                <g
                  key={`due-${f.workItemId}`}
                  className={cls('due', dim, f.draft && 'draft')}
                  data-due={f.workItemId}
                  transform={`translate(${preview?.kind === 'item' && preview.id === f.workItemId ? preview.x : f.x} ${f.y})`}
                  {...button(f.ariaLabel)}
                >
                  <rect className="due-hit" x={-7} y={-19} width={20} height={26} />
                  <path className="due-pole" d="M0 -17 V5" />
                  <path
                    className="due-flag"
                    d="M0 -17 L12 -12.5 L0 -8 Z"
                    style={{ fill: color(f.tone) }}
                  />
                  <title>{f.tooltip}</title>
                </g>
              ))}
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
                  <rect width={c.width} height={c.height} rx={7.5} />
                  <text x={9} y={11}>
                    {c.label}
                  </text>
                </g>
              ))}
            </Fragment>
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
            <rect
              className="ms-d"
              x={-7}
              y={-7}
              width={14}
              height={14}
              transform="rotate(45)"
              style={{ stroke: color(m.stroke), fill: m.filled ? color(m.tone) : 'var(--panel)' }}
            />
            <text
              className="ms-label"
              x={m.labelX - m.x}
              y={m.labelY - m.y}
              textAnchor={m.anchor}
              style={{ fill: color(m.labelTone) }}
            >
              {moved?.label ?? m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Legend() {
  const line = (background: string, label: string, extra?: object) => (
    <span>
      <i className="ln" style={{ background, ...extra }} />
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
        <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
          <path d="M2 1V13" stroke="var(--ink-2)" strokeWidth="1.5" />
          <path d="M2 1L10 4L2 7Z" fill="var(--ink-3)" />
        </svg>
        Planned finish (drag to move)
      </span>
      {line('var(--ink-3)', 'Moved from the first date', { height: 1 })}
      {line('var(--ink-3)', 'Link to its milestone', { height: 1, opacity: 0.6 })}
      {(Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>).map((status) => (
        <span key={status} style={{ color: color(STATUS_TONE[status]) }}>
          <i className={cls('dia', status !== 'planned' && 'fill')} />
          <span style={{ color: 'var(--ink-2)' }}>{STATUS_LABEL[status]}</span>
        </span>
      ))}
    </div>
  );
}
