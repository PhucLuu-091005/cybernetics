import type { Scope } from '../../contracts';

export const SCOPES: { scope: Scope; title: string; text: string }[] = [
  {
    scope: 'project:read',
    title: 'Read the project',
    text: 'Main, the Queue and the change requests.',
  },
  {
    scope: 'queue:add',
    title: 'Add to the Queue',
    text: 'Events and work items wait in the Queue. Main does not change.',
  },
];

export function permissionTitles(scopes: readonly Scope[]): string {
  const titles = SCOPES.filter((item) => scopes.includes(item.scope)).map((item) => item.title);
  return titles.length ? titles.join(', ') : 'No permissions';
}
