import { ProjectSchema } from '../../contracts';
import { FirstMilestoneSchema, noNul, ProjectTeamsSchema } from '../../tracker/schemas';

export const NAME_MAX = ProjectSchema.shape.title.maxLength ?? undefined;
export const CLIENT_MAX = ProjectSchema.shape.clientName.maxLength ?? undefined;
const TitleSchema = noNul(ProjectSchema.shape.title);
const ClientSchema = noNul(ProjectSchema.shape.clientName);
/** The functions that most delivery projects hand work between; each one goes with one click. */
export const DEFAULT_TEAMS: readonly string[] = [
  'Product',
  'Design',
  'Engineering',
  'QA',
  'Operations',
];
const MILESTONE_PROBLEM = 'Give the first milestone a name and a date, or leave its fields empty.';

export type NewProjectForm = {
  name: string;
  client: string;
  teams: readonly string[];
  milestoneName: string;
  milestoneDate: string;
  /** HH:mm, or empty for the end of the day. */
  milestoneTime?: string;
};
export type NewProjectBody = {
  title: string;
  clientName: string;
  teams: string[];
  milestone?: { name: string; date: string; time?: string };
};

const teamsOf = (form: NewProjectForm) => ProjectTeamsSchema.safeParse(form.teams);

/** Adds a typed team to the list, or says why it cannot go in; a blank name changes nothing. */
export function addTeamName(
  teams: readonly string[],
  raw: string,
): { teams: readonly string[]; problem: string | null } {
  const name = raw.trim();
  if (!name) return { teams, problem: null };
  const taken = teams.find((team) => team.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (taken) return { teams, problem: `${taken} is already in the list.` };
  const next = [...teams, name];
  const parsed = ProjectTeamsSchema.safeParse(next);
  return parsed.success
    ? { teams: next, problem: null }
    : { teams, problem: `${parsed.error.issues[0].message}.` };
}

/** null: no first milestone; a string: why the server would refuse it. */
function milestoneOf(
  form: NewProjectForm,
): NonNullable<NewProjectBody['milestone']> | null | string {
  const name = form.milestoneName.trim(),
    date = form.milestoneDate,
    time = form.milestoneTime ?? '';
  if (!name && !date) return time ? MILESTONE_PROBLEM : null;
  if (!name || !date) return MILESTONE_PROBLEM;
  const parsed = FirstMilestoneSchema.safeParse({ name, date, ...(time ? { time } : {}) });
  return parsed.success ? (parsed.data ?? null) : parsed.error.issues[0].message;
}

/** The contract's own field schemas decide validity, so the dialog never drifts from the server. */
export function newProjectBody(form: NewProjectForm): NewProjectBody | null {
  const title = TitleSchema.safeParse(form.name.trim());
  const clientName = ClientSchema.safeParse(form.client.trim());
  const teams = teamsOf(form);
  const milestone = milestoneOf(form);
  if (!title.success || !clientName.success || !teams.success || typeof milestone === 'string')
    return null;
  return {
    title: title.data,
    clientName: clientName.data,
    teams: teams.data,
    ...(milestone ? { milestone } : {}),
  };
}

export function newProjectProblem(form: NewProjectForm): string | null {
  const teams = teamsOf(form);
  if (!teams.success) return teams.error.issues[0].message;
  const milestone = milestoneOf(form);
  return typeof milestone === 'string' ? milestone : null;
}
