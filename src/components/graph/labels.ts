import type { BreakdownType, LoopState, MilestoneStatus } from '../../contracts/engine';
import type { ActType, Department, Due, Party, Person } from '../../contracts/graph';
import type { BranchSegment } from '../../contracts/layout';

export const ACT_LABEL: Record<ActType, string> = { request: 'Request', promise: 'Promise', counter: 'Counter', decline: 'Decline', renegotiate: 'Renegotiate', agree_change: 'Agree to change', report_done: 'Report done', accept: 'Accept', reject: 'Reject', cancel: 'Cancel', follow_up: 'Follow-up' };
export const BREAKDOWN_LABEL: Record<BreakdownType, string> = { unanswered_request: 'Unanswered request', silent_overdue: 'Silent overdue', late_delivery: 'Late delivery', unilateral_change: 'Unilateral change', rejected_delivery: 'Rejected delivery', ambiguous_promise: 'Ambiguous promise', unconfirmed_delivery: 'Unconfirmed delivery' };
export const STATE_COLOR: Record<LoopState, string> = { requested: 'var(--route)', negotiating: 'var(--route)', promised: 'var(--route)', change_pending: 'var(--caution)', delivered: 'var(--route)', closed: 'var(--proceed)', declined: 'var(--isolated)', cancelled: 'var(--isolated)' };
export const TONE_COLOR: Record<BranchSegment['tone'], string> = { green: 'var(--proceed)', blue: 'var(--route)', red: 'var(--danger)', amber: 'var(--caution)', gray: 'var(--isolated)' };
export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = { reached: 'Reached', blocked: 'Blocked', at_risk: 'At risk', on_track: 'On track' };
export const stateLabel = (state: LoopState | null) => state === null ? 'no acts yet' : state.replaceAll('_', ' ');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortStamp(instant: string, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.hour}:${parts.minute}`;
}
export function shortDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}
export function dueLabel(due: Due): string {
  if (!due) return 'none';
  const [year, month] = due.date.split('-').map(Number);
  if (due.precision === 'month') return `${MONTHS[month - 1]} ${year}`;
  return due.precision === 'week' ? `week of ${shortDate(due.date)}` : shortDate(due.date);
}

export type Directory = { people: ReadonlyMap<string, Person>; departments: ReadonlyMap<string, Department> };
export function partyName(party: Party, directory: Directory): string {
  if (party.kind === 'side') return party.side === 'client' ? 'Client' : 'Vendor';
  return directory.people.get(party.personId)?.name ?? 'Unknown person';
}
export function partyDetail(party: Party, directory: Directory): string {
  if (party.kind === 'side') return 'Whole side';
  const person = directory.people.get(party.personId);
  if (!person) return 'Not in the people list';
  const side = person.side === 'client' ? 'Client' : person.side === 'vendor' ? 'Vendor' : 'Unknown side';
  const department = person.departmentId ? directory.departments.get(person.departmentId)?.name : null;
  return department ? `${side}, ${department}` : side;
}
