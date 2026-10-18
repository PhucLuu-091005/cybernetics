import type { KeyKind } from '../../contracts';

export const KEY_COPY: Record<
  KeyKind,
  {
    list: string;
    column: string;
    lede: string;
    empty: string;
    table: string;
    create: string;
    hint: string;
    button: string;
    notCreated: string;
  }
> = {
  project: {
    list: 'Agent tokens',
    column: 'Token',
    lede: 'A token lets your own AI agent work in this project through MCP, with the permissions you pick. Only you see your tokens.',
    empty: 'No tokens yet. Create one below to connect your agent.',
    table: 'Your agent tokens',
    create: 'Create a token',
    hint: 'Each permission is one of your own rights. The agent can never manage tokens, delete the project or hand over the project lead.',
    button: 'Create token',
    notCreated: 'The token was not created.',
  },
  personal: {
    list: 'Personal keys',
    column: 'Key',
    lede: 'A personal key lets your own AI agent work in every project you belong to, now and later, as you. In each project it has only the rights you hold there. Only you see your keys.',
    empty: 'No personal keys yet. Create one below to connect your agent.',
    table: 'Your personal keys',
    create: 'Create a personal key',
    hint: 'A permission is offered when you hold its right in at least one project. The agent can never manage keys, delete a project or hand over a project lead.',
    button: 'Create key',
    notCreated: 'The key was not created.',
  },
};
