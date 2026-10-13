import type { BreakdownType, DerivedAct, DerivedLoop, EngineOutput } from '../../contracts/engine';
import type { ActType, Department, Party, Person } from '../../contracts/graph';
import { LayoutOptionsSchema, type ActGlyph, type BranchLayout, type BranchSegment, type GraphLayout, type LaneLayout, type LayoutInput, type LayoutOptions, type MilestoneLayout } from '../../contracts/layout';
import { createTimeScale, type TimeScale } from './time';

export { createTimeScale, xOf, type TimeScale } from './time';

type Tone = BranchSegment['tone'];
type Style = BranchSegment['style'];
// Vertical bands and curve geometry come from the approved design file (docs/design/2026-10-13-promise-graph-ui.html).
const AXIS_HEIGHT = 26, TRUNK_BAND = 58, BOTTOM_MARGIN = 30, CURVE = 16;
const GLYPH: Record<ActType, string> = { request: '○', promise: '●', counter: '◇', renegotiate: '◇', agree_change: '✓', report_done: '◐', accept: '◉', reject: '✕', follow_up: '·', decline: '■', cancel: '■' };
const ACT_LABEL: Record<ActType, string> = { request: 'Request', promise: 'Promise', counter: 'Counter', decline: 'Decline', renegotiate: 'Renegotiate', agree_change: 'Agree to change', report_done: 'Report done', accept: 'Accept', reject: 'Reject', cancel: 'Cancel', follow_up: 'Follow-up' };
const BREAKDOWN_LABEL: Record<BreakdownType, string> = { unanswered_request: 'Unanswered request', silent_overdue: 'Silent overdue', late_delivery: 'Late delivery', unilateral_change: 'Unilateral change', rejected_delivery: 'Rejected delivery', ambiguous_promise: 'Ambiguous promise', unconfirmed_delivery: 'Unconfirmed delivery' };
const FIRM: ReadonlySet<ActType> = new Set(['agree_change', 'report_done', 'accept', 'decline', 'cancel']);

const round = (value: number) => Math.round(value * 100) / 100;
const num = (value: number) => String(round(value));
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

interface Draft { loop: DerivedLoop; department: Department; startEpoch: number; xStart: number; lineEnd: number; xEnd: number; endKind: BranchLayout['endKind']; row: number }

function zoomLevel(pxPerDay: number): GraphLayout['zoomLevel'] {
  return pxPerDay < 6 ? 'milestones' : pxPerDay > 40 ? 'detail' : 'branches';
}

function endOf(loop: DerivedLoop, T: string): { kind: BranchLayout['endKind']; at: string } {
  if (loop.state === 'closed' && loop.closedAt) return { kind: 'merge', at: loop.closedAt };
  if ((loop.state === 'declined' || loop.state === 'cancelled') && loop.terminatedAt) return { kind: 'cap', at: loop.terminatedAt };
  return { kind: 'open', at: T };
}

function hedgeIntervals(acts: readonly DerivedAct[], scale: TimeScale, lineEnd: number): [number, number][] {
  const intervals: [number, number][] = [];
  let open: number | null = null;
  for (const act of acts) {
    if (open === null && act.type === 'promise' && act.hedged) open = round(scale.x(act.occurredAt));
    else if (open !== null && ((act.type === 'promise' && !act.hedged) || FIRM.has(act.type))) { intervals.push([open, round(scale.x(act.occurredAt))]); open = null; }
  }
  if (open !== null) intervals.push([open, lineEnd]);
  return intervals;
}

function segmentsOf(loop: DerivedLoop, scale: TimeScale, xStart: number, lineEnd: number, tailEnd: number): { segments: BranchSegment[]; tone: Tone } {
  const base: Tone = loop.state === 'closed' ? 'green' : loop.state === 'declined' || loop.state === 'cancelled' ? 'gray' : 'blue';
  const broken = loop.breakdowns.filter(item => item.severity === 'broken'), warnings = loop.breakdowns.filter(item => item.severity === 'warning');
  const changing = broken.length ? broken : warnings;
  const changeTone: Tone = broken.length ? 'red' : 'amber';
  const changeAt = changing.reduce<string | null>((first, item) => first === null || Date.parse(item.startAt) < Date.parse(first) ? item.startAt : first, null);
  const changeX = changeAt === null ? null : clamp(round(scale.x(changeAt)), xStart, lineEnd);
  const tone: Tone = broken.length ? 'red' : warnings.length || loop.dueSoon ? 'amber' : base;
  const hedges = hedgeIntervals(loop.acts, scale, lineEnd);
  const waiting = loop.state === 'requested' || ((loop.state === 'negotiating' || loop.state === 'change_pending') && loop.pendingTerms !== null);
  const waitX = waiting && loop.acts.length ? round(scale.x(loop.acts.at(-1)!.occurredAt)) : null;
  const styleAt = (x: number): Style => waitX !== null && x >= waitX ? 'dotted' : hedges.some(([a, b]) => a <= x && x < b) ? 'dashed' : 'solid';
  const toneAt = (x: number): Tone => changeX !== null && x >= changeX ? changeTone : base;
  const cuts = [...new Set([xStart, lineEnd, ...(changeX === null ? [] : [changeX]), ...hedges.flat(), ...(waitX === null ? [] : [waitX])])].filter(x => x >= xStart && x <= lineEnd).sort((a, b) => a - b);
  const segments: BranchSegment[] = [];
  if (cuts.length === 1) segments.push({ startX: xStart, endX: xStart, style: styleAt(xStart), tone: toneAt(xStart) });
  for (let i = 1; i < cuts.length; i++) {
    const startX = cuts[i - 1], endX = cuts[i], style = styleAt(startX), segmentTone = toneAt(startX), last = segments.at(-1);
    if (last && last.style === style && last.tone === segmentTone) last.endX = endX;
    else segments.push({ startX, endX, style, tone: segmentTone });
  }
  if (tailEnd > lineEnd) segments.push({ startX: lineEnd, endX: tailEnd, style: 'solid', tone: 'amber' });
  return { segments, tone };
}

function partyLabels(party: Party, people: ReadonlyMap<string, Person>): { name: string; initials: string } {
  if (party.kind === 'side') return { name: party.side, initials: party.side };
  const name = people.get(party.personId)?.name;
  if (!name) return { name: 'unknown person', initials: '?' };
  return { name, initials: name.split(/\s+/).filter(Boolean).map(word => Array.from(word)[0].toUpperCase()).join('') };
}

function packRows(drafts: Draft[], branchGap: number): Map<string, number> {
  const rowEnds = new Map<string, number[]>();
  for (const draft of drafts) {
    const ends = rowEnds.get(draft.department.id) ?? [];
    let row = ends.findIndex(end => draft.xStart - end >= branchGap);
    if (row < 0) { row = ends.length; ends.push(draft.xEnd); }
    ends[row] = draft.xEnd;
    draft.row = row;
    rowEnds.set(draft.department.id, ends);
  }
  return new Map([...rowEnds].map(([id, ends]) => [id, ends.length]));
}

export function layoutPromiseGraph(engine: EngineOutput, input: LayoutInput, options: LayoutOptions): GraphLayout {
  const { pxPerDay, rowHeight, lanePadding, branchGap } = LayoutOptionsSchema.parse(options);
  const { context } = input;
  const scale = createTimeScale(context, pxPerDay);
  const people = new Map(context.people.map(person => [person.id, person]));
  const departments = new Map(context.departments.map(department => [department.id, department]));
  const xT = round(scale.x(engine.T));

  const drafts: Draft[] = [];
  for (const loop of engine.loops) {
    const department = departments.get(loop.loop.performerDepartmentId);
    // A loop without a lane fails reference validation elsewhere.
    if (!department) continue;
    // A loop with no acts at or before T still counts in the engine, so it stays visible as a point at T.
    const startAt = loop.acts[0]?.occurredAt ?? engine.T;
    const xStart = round(scale.x(startAt)), end = endOf(loop, engine.T);
    const lineEnd = Math.max(xStart, end.kind === 'open' ? xT : round(scale.x(end.at)));
    const tailEnd = end.kind === 'open' && loop.dueSoon && loop.dueAt ? Math.max(lineEnd, round(scale.x(loop.dueAt))) : lineEnd;
    drafts.push({ loop, department, startEpoch: Date.parse(startAt), xStart, lineEnd, xEnd: tailEnd, endKind: end.kind, row: 0 });
  }
  drafts.sort((a, b) => a.startEpoch - b.startEpoch || compareId(a.loop.loop.id, b.loop.loop.id));
  const subRows = packRows(drafts, branchGap);

  const bySide = (side: Department['side']) => context.departments.filter(department => department.side === side).sort((a, b) => a.order - b.order || compareId(a.id, b.id));
  const laneHeight = (id: string) => Math.max(1, subRows.get(id) ?? 0) * rowHeight + lanePadding;
  const vendor = bySide('vendor'), client = bySide('client');
  const trunkY = AXIS_HEIGHT + vendor.reduce((sum, department) => sum + laneHeight(department.id), 0) + TRUNK_BAND / 2;
  const lanes: LaneLayout[] = [];
  const lane = (department: Department, y: number): LaneLayout => ({ id: department.id, departmentId: department.id, name: department.name, side: department.side, order: department.order, y, height: laneHeight(department.id), subRows: subRows.get(department.id) ?? 0 });
  let top = trunkY - TRUNK_BAND / 2;
  for (const department of vendor) { top -= laneHeight(department.id); lanes.push(lane(department, top)); }
  let bottom = trunkY + TRUNK_BAND / 2;
  for (const department of client) { lanes.push(lane(department, bottom)); bottom += laneHeight(department.id); }
  const laneById = new Map(lanes.map(item => [item.departmentId, item]));
  const rowY = (departmentId: string, row: number) => {
    const { y, height, side } = laneById.get(departmentId)!;
    return side === 'vendor' ? y + height - lanePadding / 2 - rowHeight / 2 - row * rowHeight : y + lanePadding / 2 + rowHeight / 2 + row * rowHeight;
  };

  const branches: BranchLayout[] = drafts.map(({ loop, department, xStart, lineEnd, xEnd, endKind, row }) => {
    const y = round(rowY(department.id, row));
    const { segments, tone } = segmentsOf(loop, scale, xStart, lineEnd, xEnd);
    let mergeAccept = -1;
    if (endKind === 'merge') for (let i = loop.acts.length - 1; i >= 0 && mergeAccept < 0; i--) if (loop.acts[i].type === 'accept' && loop.acts[i].occurredAt === loop.closedAt) mergeAccept = i;
    const glyphs: ActGlyph[] = loop.acts.flatMap((act, index) => {
      if (index === mergeAccept) return [];
      const actor = partyLabels(act.actor, people);
      return [{ id: act.id, loopId: loop.loop.id, type: act.type, x: round(scale.x(act.occurredAt)), y, glyph: GLYPH[act.type], label: `${ACT_LABEL[act.type].toLowerCase()} ${actor.initials}`, accessibleName: `${ACT_LABEL[act.type]} by ${actor.name}, ${scale.localStamp(act.occurredAt)}` }];
    });
    const breakdownMarkers = loop.breakdowns.filter(item => item.severity === 'broken')
      .map(item => ({ x: clamp(round(scale.x(item.startAt)), xStart, lineEnd), y, label: BREAKDOWN_LABEL[item.type] }))
      .sort((a, b) => a.x - b.x || compareId(a.label, b.label));
    const fork = `M${num(xStart - CURVE)} ${num(trunkY)} C${num(xStart - 4)} ${num(trunkY)} ${num(xStart - 12)} ${num(y)} ${num(xStart)} ${num(y)} H${num(xEnd)}`;
    const merge = endKind === 'merge' ? ` C${num(xEnd + 12)} ${num(y)} ${num(xEnd + 4)} ${num(trunkY)} ${num(xEnd + CURVE)} ${num(trunkY)}` : '';
    const labels = [...new Set(loop.breakdowns.map(item => BREAKDOWN_LABEL[item.type].toLowerCase()))];
    const status = labels.length ? labels.join(', ') : loop.acts.length === 0 ? 'no acts yet' : (loop.state ?? 'no state').replaceAll('_', ' ');
    return { id: loop.loop.id, loopId: loop.loop.id, departmentId: department.id, row, xStart, xEnd, y, path: fork + merge, segments, glyphs, tone, endKind, breakdownMarkers, title: loop.loop.title, accessibleName: `Loop: ${loop.loop.title}, ${department.name}, ${status}` };
  });

  const milestones: MilestoneLayout[] = [...engine.milestones]
    .sort((a, b) => compareId(a.currentDate, b.currentDate) || a.milestone.order - b.milestone.order || compareId(a.milestone.id, b.milestone.id))
    .map(({ milestone, currentDate, status, openLoopCount, brokenLoopCount }) => {
      const x = round(scale.dateX(currentDate)), moved = milestone.plannedDate !== currentDate;
      const ghostX = moved ? round(scale.dateX(milestone.plannedDate)) : null;
      let slipPath: string | null = null;
      if (ghostX !== null) {
        const direction = x >= ghostX ? 1 : -1, middle = (ghostX + x) / 2;
        slipPath = `M${num(ghostX + 10 * direction)} ${num(trunkY - 14)} C${num(middle)} ${num(trunkY - 26)} ${num(middle)} ${num(trunkY - 26)} ${num(x - 10 * direction)} ${num(trunkY - 14)}`;
      }
      const when = moved ? `moved from ${milestone.plannedDate} to ${currentDate}` : currentDate;
      return { id: milestone.id, x, y: trunkY, ghostX, slipPath, label: milestone.name, accessibleName: `Milestone: ${milestone.name}, ${when}, ${status.replaceAll('_', ' ')}`, openLoopCount, brokenLoopCount };
    });

  const width = Math.max(scale.dateEndX(context.windowEnd), ...branches.map(branch => branch.xEnd + CURVE), ...milestones.map(item => item.x + CURVE));
  return {
    width: round(Math.max(0, width)), height: round(bottom + BOTTOM_MARGIN), trunkY, lanes, branches, milestones, zoomLevel: zoomLevel(pxPerDay),
    navigation: { milestoneIds: milestones.map(item => item.id), loopIds: branches.map(branch => branch.loopId) },
  };
}
