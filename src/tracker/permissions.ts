/**
 * Who may do what in a project. The browser and the server use this one rule.
 *
 * - The project lead (one per project) has every right and manages members, teams and grants.
 * - A member has four grants: View Main, View change requests, Create change requests and
 *   Merge change requests. Create and Merge need View change requests; every grant needs View Main.
 * - A team lead can always create (and so view) change requests.
 * - A reader with no member row (a person of the workspace) reads Main and change requests only.
 */
export const GRANTS = ['viewMain', 'viewCrs', 'createCrs', 'mergeCrs'] as const;
export type Grant = (typeof GRANTS)[number];
export type Grants = Record<Grant, boolean>;

export const GRANT_LABEL: Record<Grant, string> = {
  viewMain: 'View Main',
  viewCrs: 'View change requests',
  createCrs: 'Create change requests',
  mergeCrs: 'Merge change requests',
};

export const NO_GRANTS: Grants = {
  viewMain: false,
  viewCrs: false,
  createCrs: false,
  mergeCrs: false,
};
/** What an invite gets, the same as a round 6 member. */
export const DEFAULT_GRANTS: Grants = {
  ...NO_GRANTS,
  viewMain: true,
  viewCrs: true,
  createCrs: true,
};
export const ALL_GRANTS: Grants = {
  viewMain: true,
  viewCrs: true,
  createCrs: true,
  mergeCrs: true,
};

const NEEDS: Record<Grant, Grant[]> = {
  viewMain: [],
  viewCrs: ['viewMain'],
  createCrs: ['viewCrs', 'viewMain'],
  mergeCrs: ['viewCrs', 'viewMain'],
};

export function closeGrants(grants: Grants): Grants {
  const next = { ...grants };
  for (const grant of GRANTS) if (grants[grant]) for (const need of NEEDS[grant]) next[need] = true;
  return next;
}

export function setGrant(grants: Grants, grant: Grant, on: boolean): Grants {
  if (on) return closeGrants({ ...grants, [grant]: true });
  const next = { ...grants, [grant]: false };
  for (const other of GRANTS) if (NEEDS[other].includes(grant)) next[other] = false;
  return next;
}

/** The grants that are on and need this one, so the UI can say why it cannot be turned off alone. */
export const impliedBy = (grants: Grants, grant: Grant): Grant[] =>
  GRANTS.filter((other) => grants[other] && NEEDS[other][0] === grant);

export type Rights = {
  viewMain: boolean;
  viewCrs: boolean;
  create: boolean;
  merge: boolean;
  /** Members, teams, grants and the project lead hand-over. */
  manage: boolean;
};
export type Right = keyof Rights | 'edit';

export type PermissionSubject = {
  me: { id: string; grants: Grants } | null;
  project: { leadMemberId: string };
  base: { teams: ReadonlyArray<{ leadId: string | null }> };
};

const READER: Rights = {
  viewMain: true,
  viewCrs: true,
  create: false,
  merge: false,
  manage: false,
};

export function memberRights(facts: {
  projectLead: boolean;
  teamLead: boolean;
  grants: Grants;
}): Rights {
  if (facts.projectLead)
    return { viewMain: true, viewCrs: true, create: true, merge: true, manage: true };
  const grants = closeGrants(facts.teamLead ? { ...facts.grants, createCrs: true } : facts.grants);
  return {
    viewMain: grants.viewMain,
    viewCrs: grants.viewCrs,
    create: grants.createCrs,
    merge: grants.mergeCrs,
    manage: false,
  };
}

export function rightsOf(subject: PermissionSubject): Rights {
  const { me } = subject;
  if (!me) return READER;
  return memberRights({
    projectLead: me.id === subject.project.leadMemberId,
    teamLead: subject.base.teams.some((team) => team.leadId === me.id),
    grants: me.grants,
  });
}

type CrPart = {
  author: string;
  editor: string;
  shares: ReadonlyArray<{ memberId: string; permission: string }>;
};

/**
 * `can(payload, 'merge')`. With a change request, `edit` also needs a part in it: its author,
 * its editor or an edit share.
 */
export function can(subject: PermissionSubject, right: Right, cr?: CrPart): boolean {
  const rights = rightsOf(subject);
  if (right !== 'edit') return rights[right];
  if (!rights.create || !subject.me) return false;
  if (!cr) return true;
  const id = subject.me.id;
  return (
    cr.author === id ||
    cr.editor === id ||
    cr.shares.some((share) => share.memberId === id && share.permission === 'edit')
  );
}

/** A merged change request is part of Main's history; a share or a part in one also shows it. */
export function canSeeCr(subject: PermissionSubject, cr: CrPart & { status: string }): boolean {
  const rights = rightsOf(subject);
  if (rights.viewCrs) return true;
  if (!rights.viewMain) return false;
  const id = subject.me?.id;
  return (
    cr.status === 'merged' ||
    (!!id &&
      (cr.author === id || cr.editor === id || cr.shares.some((share) => share.memberId === id)))
  );
}

export function mergerIds(
  subject: PermissionSubject & {
    members: ReadonlyArray<{ id: string; grants: Grants; active: boolean }>;
  },
): string[] {
  const lead = subject.project.leadMemberId;
  return subject.members
    .filter((member) => member.active && rightsOf({ ...subject, me: member }).merge)
    .map((member) => member.id)
    .sort((a, b) => Number(b === lead) - Number(a === lead));
}
