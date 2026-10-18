import type { Scope } from './identity';

export const SCOPE_GROUPS = [
  'Read',
  'Queue',
  'Change requests',
  'People and teams',
  'Project',
] as const;
export type ScopeGroup = (typeof SCOPE_GROUPS)[number];

/** The right of the creator that a scope also needs; the server checks it again at each call. */
export type ScopeNeed = 'viewMain' | 'member' | 'create' | 'merge' | 'manage';

export type ScopeInfo = {
  scope: Scope;
  group: ScopeGroup;
  title: string;
  short: string;
  /** What the agent can then do, in one line. */
  text: string;
  need: ScopeNeed;
};

export const SCOPE_INFO: readonly ScopeInfo[] = [
  {
    scope: 'project:read',
    group: 'Read',
    title: 'Read the project',
    short: 'Read',
    text: 'Read Main, the Queue, the change requests and the members.',
    need: 'viewMain',
  },
  {
    scope: 'queue:add',
    group: 'Queue',
    title: 'Add to the Queue',
    short: 'Add to Queue',
    text: 'Add events and work items to the Queue. Main does not change.',
    need: 'create',
  },
  {
    scope: 'queue:dismiss',
    group: 'Queue',
    title: 'Remove Queue cards',
    short: 'Remove cards',
    text: 'Remove a Queue card that no change request uses.',
    need: 'create',
  },
  {
    scope: 'crs:edit',
    group: 'Change requests',
    title: 'Edit change requests',
    short: 'Edit CRs',
    text: 'Open change requests, add and remove changes, share and hand them over.',
    need: 'create',
  },
  {
    scope: 'crs:ready',
    group: 'Change requests',
    title: 'Mark ready',
    short: 'Mark ready',
    text: 'Mark a change request ready to merge, or move it back to draft.',
    need: 'create',
  },
  {
    scope: 'crs:comment',
    group: 'Change requests',
    title: 'Comment',
    short: 'Comment',
    text: 'Comment on a change request or on one of its changes.',
    need: 'member',
  },
  {
    scope: 'crs:merge',
    group: 'Change requests',
    title: 'Merge into Main',
    short: 'Merge',
    text: 'Merge a ready change request into Main, or ask for changes.',
    need: 'merge',
  },
  {
    scope: 'crs:close',
    group: 'Change requests',
    title: 'Cancel change requests',
    short: 'Cancel CRs',
    text: 'Cancel a change request you wrote or edit, or any one if you can merge.',
    need: 'member',
  },
  {
    scope: 'members:manage',
    group: 'People and teams',
    title: 'Manage members',
    short: 'Members',
    text: 'Invite people, change their rights and remove them.',
    need: 'manage',
  },
  {
    scope: 'teams:manage',
    group: 'People and teams',
    title: 'Manage teams',
    short: 'Teams',
    text: 'Add, rename and delete teams, and set their people and lead.',
    need: 'manage',
  },
  {
    scope: 'project:lead',
    group: 'Project',
    title: 'Hand over the project lead',
    short: 'Project lead',
    text: 'Make another member the project lead. You then lose the lead.',
    need: 'manage',
  },
];

/** The creator of a token as the settings page sees them today. */
export type Creator = {
  member: boolean;
  rights: { viewMain: boolean; create: boolean; merge: boolean; manage: boolean };
};

const BLOCKED: Record<ScopeNeed, string> = {
  viewMain: 'You cannot see Main of this project',
  member: 'Only members of the project can do this',
  create: 'You cannot create or edit change requests in this project',
  merge: 'You do not have the Merge right in this project',
  manage: 'Only the project lead can do this',
};

/** Why the creator cannot give this scope today, or null. */
export function scopeBlock(info: Pick<ScopeInfo, 'need'>, creator: Creator): string | null {
  const ok = info.need === 'member' ? creator.member : creator.rights[info.need];
  if (info.need !== 'viewMain' && !creator.member) return BLOCKED.member;
  return ok ? null : BLOCKED[info.need];
}
