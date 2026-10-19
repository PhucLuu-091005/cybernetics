import type { TrackerState } from '../../tracker';
import type { OpInput } from './api';

type NewTeam = { id: string; name: string };

const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

// Two lanes with one name would make every team picker ambiguous.
export function newTeamOp(
  state: TrackerState,
  team: NewTeam,
): { ok: true; op: OpInput } | { ok: false; message: string } {
  const name = team.name.trim();
  if (!name) return { ok: false, message: 'Give the team a name.' };
  const taken = state.teams.find((t) => sameName(t.name, name));
  if (taken) return { ok: false, message: `${taken.name} is already a team.` };
  return { ok: true, op: { op: 'addTeam', a: { id: team.id, name, leadId: null } } };
}

export function focusAction(name: string, focused: boolean): { text: string; label: string } {
  const text = focused ? 'Leave focus' : 'Focus';
  return { text, label: `${text} on ${name}` };
}

type TeamAction = 'collapse' | 'focus' | 'hide';

/** On a phone the pinned name column has no room for the row buttons, so a menu holds them. */
export function teamMenuItems(team: {
  name: string;
  count: number;
  collapsed: boolean;
  focused: boolean;
}): { action: TeamAction; text: string; label: string }[] {
  const toggle = team.collapsed ? 'Expand' : 'Collapse';
  return [
    ...(team.count > 0
      ? [{ action: 'collapse' as const, text: toggle, label: `${toggle} ${team.name}` }]
      : []),
    { action: 'focus', ...focusAction(team.name, team.focused) },
    { action: 'hide', text: 'Hide', label: `Hide ${team.name}` },
  ];
}
