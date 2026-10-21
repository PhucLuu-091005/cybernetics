import type { TrackerState } from '../../tracker';
import type { OpInput } from './api';

export type NewTeam = { id: string; name: string };

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
