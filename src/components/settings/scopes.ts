import type { Scope } from '../../contracts';

export const SCOPES: { scope: Scope; title: string; text: string; risk?: true }[] = [
  {
    scope: 'project:read',
    title: 'Read the project',
    text: 'Records, the graph, notes and activity.',
  },
  {
    scope: 'records:import',
    title: 'Add records',
    text: 'Paste or import messages. The graph does not change.',
  },
  {
    scope: 'graph:propose',
    title: 'Suggest changes',
    text: 'Change sets wait for a person to approve them.',
  },
  {
    scope: 'graph:merge',
    title: 'Approve without you',
    text: 'The agent can approve and undo changes. Grant it only to an agent that you direct.',
    risk: true,
  },
];

export function permissionTitles(scopes: readonly Scope[]): string {
  const titles = SCOPES.filter((item) => scopes.includes(item.scope)).map((item) => item.title);
  return titles.length ? titles.join(', ') : 'No permissions';
}
