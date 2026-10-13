import type { Breakdown, BreakdownType, DerivedAct, DerivedLoop, DerivedMilestone, EngineInput, EngineOutput, LoopState } from '../../../contracts/engine';
import type { Due, GraphContext, Loop, Party } from '../../../contracts/graph';
import { businessDaysBetween, localDate, resolveDueInstant } from '../../../lib/calendar';
import { isUtf16Boundary } from '../../../contracts/primitives';

const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const time = (instant: string) => Date.parse(instant);
const terminal = (state: LoopState | null) => state === 'closed' || state === 'declined' || state === 'cancelled';
const sameDue = (a: Due, b: Due) => a === null ? b === null : b !== null && a.date === b.date && a.precision === b.precision;

function identity(party: Party, context: GraphContext) {
  const person = party.kind === 'person' ? context.people.find(person => person.id === party.personId) : undefined;
  return { side: party.kind === 'side' ? party.side : person?.side, department: person?.departmentId ?? null };
}
function sameParty(a: Party, b: Party) {
  return a.kind === 'person' && b.kind === 'person' ? a.personId === b.personId : a.kind === 'side' && b.kind === 'side' && a.side === b.side;
}
function role(actor: Party, target: Party, loop: Loop, context: GraphContext) {
  if (sameParty(actor, target)) return true;
  const a = identity(actor, context), t = identity(target, context);
  const customer = identity(loop.customer, context), performer = identity(loop.performer, context);
  if (!a.side || a.side === 'unknown' || !t.side || t.side === 'unknown') return false;
  if (customer.side === performer.side) return a.department !== null && t.department !== null && a.department === t.department;
  return a.side === t.side;
}
function otherParty(actor: Party, proposer: Party, loop: Loop, context: GraphContext) {
  const a = identity(actor, context), p = identity(proposer, context);
  const customer = identity(loop.customer, context), performer = identity(loop.performer, context);
  if (customer.side && customer.side !== 'unknown' && performer.side && performer.side !== 'unknown') {
    if (customer.side === performer.side) return a.side === customer.side && p.side === customer.side && a.department !== null && p.department !== null && a.department !== p.department;
    return a.side !== undefined && a.side !== 'unknown' && p.side !== undefined && p.side !== 'unknown' && a.side !== p.side;
  }
  // Missing directory metadata can establish exact loop identities, never an invented side.
  return (sameParty(actor, loop.customer) && sameParty(proposer, loop.performer)) || (sameParty(actor, loop.performer) && sameParty(proposer, loop.customer));
}
function partyName(party: Party, context: GraphContext) {
  return party.kind === 'side' ? party.side : context.people.find(person => person.id === party.personId)?.name ?? 'Unknown person';
}

interface LoopResult { derived: DerivedLoop; agreedDue: Due | undefined }
function deriveLoop(loop: Loop, acts: DerivedAct[], context: GraphContext, T: string): LoopResult {
  const result: DerivedLoop = { loop: structuredClone(loop), state: null, acts, firstActAt: acts[0]?.occurredAt ?? null, lastActAt: acts.at(-1)?.occurredAt ?? null, requestedAt: null, promisedAt: null, deliveredAt: null, closedAt: null, terminatedAt: null, due: null, originalDue: null, dueAt: null, hedged: false, nudges: 0, rejections: 0, pendingTerms: null, cycleStartedAt: null, rejectionActIds: [], breakdowns: [], dueSoon: false };
  const days = (start: string, end = T) => businessDaysBetween(start, end, context);
  const customerName = partyName(loop.customer, context), performerName = partyName(loop.performer, context);
  const departmentName = context.departments.find(department => department.id === loop.performerDepartmentId)?.name ?? performerName;
  let commitment = null as DerivedAct | null, effectiveProof: string[] = [], cycleRejection = null as DerivedAct | null;
  let currentAction = '', delivery = null as DerivedAct | null, hedge = null as DerivedAct | null;
  let lastCustomer = null as DerivedAct | null, performerReplied = false, agreedDue: Due | undefined;
  const notices: DerivedAct[] = [], requestProof: string[] = [], rejectionProof: string[] = [];
  const late: Breakdown[] = [], unilateral: Breakdown[] = [];
  const activeProof = () => [...effectiveProof, ...(cycleRejection ? [cycleRejection.id] : [])];
  const breakdown = (type: BreakdownType, proofActIds: string[], sentence: string, startAt: string, endAt: string | null = null, businessDays: number | null = null): Breakdown => ({ type, severity: type === 'ambiguous_promise' || type === 'unconfirmed_delivery' ? 'warning' : 'broken', loopId: loop.id, proofActIds: [...new Set(proofActIds)], sentence, startAt, endAt, businessDays });
  const unilateralFact = (proposal: NonNullable<DerivedLoop['pendingTerms']>, endAt: string | null) => breakdown('unilateral_change', [proposal.actId, ...(endAt ? activeProof() : [])], `${partyName(proposal.proposer, context)} moved the date to ${proposal.due?.date ?? 'an unspecified date'}. ${otherName(proposal.proposer)} never agreed.`, proposal.proposedAt, endAt, Math.max(0, days(proposal.proposedAt, endAt ?? T)));
  const otherName = (proposer: Party) => partyName(role(proposer, loop.customer, loop, context) ? loop.performer : loop.customer, context);
  function promise(act: DerivedAct, fromPending = false) {
    const first = commitment === null;
    if (first) {
      commitment = act; result.promisedAt = act.occurredAt; result.cycleStartedAt = act.occurredAt;
      result.originalDue = structuredClone(fromPending ? result.pendingTerms!.due : act.due);
    }
    currentAction = fromPending ? result.pendingTerms!.action : act.action;
    result.due = structuredClone(fromPending ? result.pendingTerms!.due : act.due);
    result.dueAt = resolveDueInstant(result.due, context.timeZone);
    effectiveProof = fromPending ? [...(first ? [] : [commitment!.id]), result.pendingTerms!.actId, act.id] : [act.id];
    result.hedged = fromPending ? false : act.hedged;
    hedge = result.hedged ? act : null;
    result.pendingTerms = null; result.state = 'promised';
  }
  function deliver(act: DerivedAct, implicit: boolean) {
    delivery = act; result.deliveredAt = act.occurredAt; result.hedged = false; hedge = null;
    if (result.dueAt !== null && time(act.occurredAt) > time(result.dueAt)) {
      const n = Math.max(0, days(result.dueAt, act.occurredAt));
      late.push(breakdown('late_delivery', [...activeProof(), act.id], `Delivered ${n} business days after the promised date.`, result.dueAt, act.occurredAt, n));
    }
    if (result.pendingTerms?.kind === 'renegotiate') unilateral.push(unilateralFact(result.pendingTerms, act.occurredAt));
    result.state = implicit ? 'closed' : 'delivered';
    if (implicit) result.closedAt = act.occurredAt;
  }
  for (const act of acts) {
    const customer = role(act.actor, loop.customer, loop, context), performer = role(act.actor, loop.performer, loop, context);
    const member = customer || performer;
    const state = result.state;
    let valid = false;
    if (state === null) {
      if (act.type === 'request' && customer) { result.state = 'requested'; result.requestedAt = act.occurredAt; requestProof.push(act.id); valid = true; }
      if (act.type === 'promise' && performer) { promise(act); valid = true; }
    } else if (state === 'requested') {
      if (act.type === 'promise' && performer) { promise(act); valid = true; }
      if (act.type === 'counter' && performer) { result.state = 'negotiating'; valid = true; }
      if (act.type === 'decline' && performer) { result.state = 'declined'; valid = true; }
      if (act.type === 'cancel' && customer) { result.state = 'cancelled'; valid = true; }
      if (act.type === 'follow_up' && customer) { result.nudges++; requestProof.push(act.id); valid = true; }
    } else if (state === 'negotiating') {
      if (act.type === 'counter' && member) valid = true;
      if (act.type === 'agree_change' && result.pendingTerms && otherParty(act.actor, result.pendingTerms.proposer, loop, context)) { promise(act, true); valid = true; }
      if (act.type === 'promise' && performer) { promise(act); valid = true; }
      if (act.type === 'decline' && member) { result.state = 'declined'; valid = true; }
      if (act.type === 'cancel' && customer) { result.state = 'cancelled'; valid = true; }
    } else if (state === 'promised') {
      if (act.type === 'renegotiate' && member) { result.state = 'change_pending'; notices.push(act); valid = true; }
      if (act.type === 'report_done' && performer) { deliver(act, false); valid = true; }
      if (act.type === 'accept' && customer) { deliver(act, true); valid = true; }
      if (act.type === 'follow_up' && customer) { result.nudges++; valid = true; }
      if (act.type === 'cancel' && customer) { result.state = 'cancelled'; valid = true; }
      if (act.type === 'promise' && performer && currentAction === act.action && (result.due === null || act.due === null || sameDue(result.due, act.due))) {
        if (result.due === null && act.due !== null) { result.due = structuredClone(act.due); result.dueAt = resolveDueInstant(result.due, context.timeZone); effectiveProof.push(act.id); }
        if (!act.hedged) { result.hedged = false; hedge = null; }
        valid = true;
      }
    } else if (state === 'change_pending') {
      if ((act.type === 'agree_change' || act.type === 'decline') && result.pendingTerms && otherParty(act.actor, result.pendingTerms.proposer, loop, context)) {
        if (act.type === 'agree_change') { promise(act, true); agreedDue = structuredClone(result.due); }
        else { result.pendingTerms = null; result.state = 'promised'; }
        valid = true;
      }
      if (act.type === 'report_done' && performer) { deliver(act, false); valid = true; }
    } else if (state === 'delivered' && act.type === 'accept' && customer) { result.state = 'closed'; result.closedAt = act.occurredAt; valid = true; }
    if ((state === 'delivered' || state === 'closed') && act.type === 'reject' && customer) {
      result.state = 'promised'; result.rejections++; result.rejectionActIds.push(act.id);
      rejectionProof.push(...(delivery ? [delivery.id] : []), act.id);
      result.cycleStartedAt = act.occurredAt; cycleRejection = act;
      result.deliveredAt = null; result.closedAt = null; result.pendingTerms = null; delivery = null; notices.length = 0; valid = true;
    }
    if (!valid) { act.flags.push('out_of_order'); continue; }
    if (act.type === 'counter' || act.type === 'renegotiate') result.pendingTerms = { action: act.action, due: structuredClone(act.due), proposer: structuredClone(act.actor), actId: act.id, proposedAt: act.occurredAt, kind: act.type };
    if (customer) { lastCustomer = act; performerReplied = false; }
    else if (performer) performerReplied = true;
    if (result.state === 'declined' || result.state === 'cancelled') { result.terminatedAt = act.occurredAt; result.pendingTerms = null; hedge = null; result.hedged = false; }
  }
  if ((result.state === 'requested' || (result.state === 'negotiating' && result.pendingTerms && role(result.pendingTerms.proposer, loop.customer, loop, context))) && lastCustomer && !performerReplied && days(lastCustomer.occurredAt) > context.replyWindowDays) {
    const n = days(lastCustomer.occurredAt);
    result.breakdowns.push(breakdown('unanswered_request', [...requestProof, lastCustomer.id], `${customerName} waited ${n} business days for a reply from ${departmentName}.`, lastCustomer.occurredAt, null, n));
  }
  if ((result.state === 'promised' || result.state === 'change_pending') && result.dueAt && time(result.dueAt) < time(T) && !delivery && !notices.some(notice => time(notice.occurredAt) <= time(result.dueAt!))) result.breakdowns.push(breakdown('silent_overdue', activeProof(), `${performerName} promised ${currentAction} by ${result.due!.date}. No delivery or change notice by that date.`, result.dueAt, null, Math.max(0, days(result.dueAt))));
  result.breakdowns.push(...late);
  if (result.pendingTerms?.kind === 'renegotiate' && unilateral.every(fact => fact.proofActIds[0] !== result.pendingTerms!.actId) && days(result.pendingTerms.proposedAt) > context.replyWindowDays) result.breakdowns.push(unilateralFact(result.pendingTerms, null));
  result.breakdowns.push(...unilateral);
  if (result.rejections > 0) result.breakdowns.push(breakdown('rejected_delivery', rejectionProof, `${customerName} rejected the delivery ${result.rejections} time(s).`, acts.find(act => act.id === result.rejectionActIds[0])!.occurredAt, acts.find(act => act.id === result.rejectionActIds.at(-1))!.occurredAt));
  if (hedge && !terminal(result.state) && days(hedge.occurredAt) > context.hedgeWindowDays) result.breakdowns.push(breakdown('ambiguous_promise', [...activeProof(), hedge.id], hedge.quote === null ? `${performerName} made a hedged promise. The evidence quote is unavailable.` : `${performerName} said "${hedge.quote}". The client may read this as a commitment.`, hedge.occurredAt, null, days(hedge.occurredAt)));
  if (result.state === 'delivered' && delivery && days(delivery.occurredAt) > context.acceptWindowDays) { const n = days(delivery.occurredAt); result.breakdowns.push(breakdown('unconfirmed_delivery', [...activeProof(), delivery.id], `Delivered on ${localDate(delivery.occurredAt, context.timeZone)}. No confirmation from ${customerName} after ${n} business days.`, delivery.occurredAt, null, n)); }
  result.dueSoon = (result.state === 'promised' || result.state === 'change_pending') && result.dueAt !== null && time(result.dueAt) >= time(T) && days(T, result.dueAt) <= context.atRiskWindowDays;
  return { derived: result, agreedDue };
}

export function deriveProject(input: EngineInput): EngineOutput {
  const { snapshot, T } = input, context = snapshot.context;
  const records = new Map(input.records.map(record => [record.recordVersionId, record]));
  const unavailable = new Set<string>();
  const acts: DerivedAct[] = [];
  for (const act of snapshot.acts) {
    if (act.hidden) continue;
    const record = records.get(act.citation.recordVersionId);
    if (!record) { unavailable.add(act.citation.recordVersionId); continue; }
    if (time(record.occurredAt) > time(T)) continue;
    const { start, end } = act.citation;
    const available = !record.withdrawn && record.bodyText !== null && isUtf16Boundary(record.bodyText, start) && isUtf16Boundary(record.bodyText, end) && !record.quotedRanges.some(range => start < range.end && end > range.start);
    if (!available) unavailable.add(record.recordVersionId);
    acts.push({ ...structuredClone(act), occurredAt: record.occurredAt, quote: available ? record.bodyText!.slice(start, end) : null, unavailable: !available, flags: [] });
  }
  acts.sort((a, b) => time(a.occurredAt) - time(b.occurredAt) || a.citation.start - b.citation.start || compareId(a.id, b.id));
  const loops = [...snapshot.loops].sort((a, b) => compareId(a.id, b.id)).map(loop => deriveLoop(loop, acts.filter(act => act.loopId === loop.id), context, T));
  const byId = new Map(loops.map(result => [result.derived.loop.id, result]));
  const milestones: DerivedMilestone[] = [...context.milestones].sort((a, b) => a.order - b.order || compareId(a.id, b.id)).map(milestone => {
    const anchor = milestone.anchorLoopId ? byId.get(milestone.anchorLoopId) : undefined;
    const currentDate = anchor?.agreedDue?.date ?? milestone.currentDate;
    const assigned = loops.filter(result => result.derived.loop.milestoneId === milestone.id).map(result => result.derived);
    const open = assigned.filter(loop => !terminal(loop.state));
    const broken = assigned.filter(loop => loop.breakdowns.some(item => item.severity === 'broken'));
    const distance = businessDaysBetween(T, currentDate, context);
    let status: DerivedMilestone['status'] = 'on_track', reason = 'No milestone risk rule matches.';
    if ((milestone.reachedAt !== null && time(milestone.reachedAt) <= time(T)) || anchor?.derived.state === 'closed') { status = 'reached'; reason = 'The milestone was marked reached or its anchor loop is closed.'; }
    else if (localDate(T, context.timeZone) >= currentDate && open.length > 0) { status = 'blocked'; reason = 'The milestone date has arrived with unfinished assigned loops.'; }
    else if (distance >= 0 && distance <= 5 && assigned.some(loop => loop.breakdowns.length > 0 || (loop.state !== 'delivered' && loop.state !== 'closed'))) { status = 'at_risk'; reason = 'The milestone is within five business days and assigned loops have risk or unfinished work.'; }
    return { milestone: structuredClone(milestone), currentDate, status, reason, loopIds: assigned.map(loop => loop.loop.id), openLoopCount: open.length, brokenLoopCount: broken.length };
  });
  const counts: EngineOutput['counts'] = { states: { requested: 0, negotiating: 0, promised: 0, change_pending: 0, delivered: 0, closed: 0, declined: 0, cancelled: 0 }, breakdowns: { unanswered_request: 0, silent_overdue: 0, late_delivery: 0, unilateral_change: 0, rejected_delivery: 0, ambiguous_promise: 0, unconfirmed_delivery: 0 }, brokenLoops: 0, warningLoops: 0, openLoops: 0, closedLoops: 0 };
  for (const { derived: loop } of loops) {
    if (loop.state) counts.states[loop.state]++;
    if (loop.state === 'closed') counts.closedLoops++;
    if (!terminal(loop.state)) counts.openLoops++;
    if (loop.breakdowns.some(item => item.severity === 'broken')) counts.brokenLoops++;
    if (loop.dueSoon || loop.breakdowns.some(item => item.severity === 'warning')) counts.warningLoops++;
    for (const item of loop.breakdowns) counts.breakdowns[item.type]++;
  }
  return { T, loops: loops.map(result => result.derived), milestones, counts, unassignedActIds: acts.filter(act => act.loopId === null || !byId.has(act.loopId)).map(act => act.id), unavailableEvidenceCount: unavailable.size };
}
