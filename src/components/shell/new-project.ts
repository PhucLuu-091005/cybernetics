import { ProjectSchema } from '../../contracts';
import { FirstMilestoneSchema, ProjectTeamsSchema } from '../../tracker/schemas';

const { title: TitleSchema, clientName: ClientSchema } = ProjectSchema.shape;
export const NAME_MAX = TitleSchema.maxLength ?? undefined;
export const CLIENT_MAX = ClientSchema.maxLength ?? undefined;
export const DEFAULT_TEAMS = 'Implementation\nEngineering\nQA';
const MILESTONE_PROBLEM = 'Give the first milestone a name and a date, or leave both empty.';

export type NewProjectForm = {
  name: string;
  client: string;
  /** One team per line. */
  teams: string;
  milestoneName: string;
  milestoneDate: string;
};
export type NewProjectBody = {
  title: string;
  clientName: string;
  teams: string[];
  milestone?: { name: string; date: string };
};

const teamsOf = (form: NewProjectForm) => ProjectTeamsSchema.safeParse(form.teams.split(/\r?\n/));

/** null: no first milestone; undefined: a half-filled one that the server would refuse. */
function milestoneOf(form: NewProjectForm): { name: string; date: string } | null | undefined {
  if (!form.milestoneName.trim() && !form.milestoneDate) return null;
  const parsed = FirstMilestoneSchema.safeParse({
    name: form.milestoneName,
    date: form.milestoneDate,
  });
  return parsed.success && parsed.data ? parsed.data : undefined;
}

/** The contract's own field schemas decide validity, so the dialog never drifts from the server. */
export function newProjectBody(form: NewProjectForm): NewProjectBody | null {
  const title = TitleSchema.safeParse(form.name.trim());
  const clientName = ClientSchema.safeParse(form.client.trim());
  const teams = teamsOf(form);
  const milestone = milestoneOf(form);
  if (!title.success || !clientName.success || !teams.success || milestone === undefined)
    return null;
  return {
    title: title.data,
    clientName: clientName.data,
    teams: teams.data,
    ...(milestone ? { milestone } : {}),
  };
}

/** Name and client rely on the browser required check; teams and the milestone need their own words. */
export function newProjectProblem(form: NewProjectForm): string | null {
  const teams = teamsOf(form);
  if (!teams.success) return teams.error.issues[0].message;
  return milestoneOf(form) === undefined ? MILESTONE_PROBLEM : null;
}
