import { describe, expect, it } from 'vitest';
import {
  can,
  canSeeCr,
  closeGrants,
  DEFAULT_GRANTS,
  impliedBy,
  mergerIds,
  NO_GRANTS,
  rightsOf,
  setGrant,
  type Grants,
  type PermissionSubject,
} from '../../../src/tracker/permissions';

const grants = (...on: Array<keyof Grants>): Grants => ({
  ...NO_GRANTS,
  ...Object.fromEntries(on.map((g) => [g, true])),
});

const subject = (
  me: { id: string; grants: Grants } | null,
  leads: Array<string | null> = [],
  lead = 'minh',
): PermissionSubject => ({
  me,
  project: { leadMemberId: lead },
  base: { teams: leads.map((leadId) => ({ leadId })) },
});

describe('grants', () => {
  it('closes upward: a change request right needs Main, create and merge need the list', () => {
    expect(closeGrants(grants('createCrs'))).toEqual(grants('viewMain', 'viewCrs', 'createCrs'));
    expect(closeGrants(grants('mergeCrs'))).toEqual(grants('viewMain', 'viewCrs', 'mergeCrs'));
    expect(closeGrants(grants('viewCrs'))).toEqual(grants('viewMain', 'viewCrs'));
    expect(closeGrants(NO_GRANTS)).toEqual(NO_GRANTS);
  });

  it('turns on what a grant needs, and turns off what needs a grant that goes', () => {
    expect(setGrant(NO_GRANTS, 'createCrs', true)).toEqual(
      grants('viewMain', 'viewCrs', 'createCrs'),
    );
    const all = grants('viewMain', 'viewCrs', 'createCrs', 'mergeCrs');
    expect(setGrant(all, 'viewCrs', false)).toEqual(grants('viewMain'));
    expect(setGrant(all, 'viewMain', false)).toEqual(NO_GRANTS);
    expect(setGrant(all, 'mergeCrs', false)).toEqual(grants('viewMain', 'viewCrs', 'createCrs'));
  });

  it('names the grants that hold a grant on', () => {
    expect(impliedBy(grants('viewMain', 'viewCrs', 'createCrs'), 'viewCrs')).toEqual(['createCrs']);
    expect(impliedBy(grants('viewMain', 'viewCrs'), 'viewMain')).toEqual(['viewCrs']);
    expect(impliedBy(grants('viewMain'), 'viewMain')).toEqual([]);
  });

  it('gives a new member Main and change requests to view and create, as a round 6 member', () => {
    expect(DEFAULT_GRANTS).toEqual(grants('viewMain', 'viewCrs', 'createCrs'));
  });
});

describe('rightsOf and can', () => {
  it('gives the project lead every right, whatever the stored grants say', () => {
    const rights = rightsOf(subject({ id: 'minh', grants: NO_GRANTS }));
    expect(rights).toEqual({
      viewMain: true,
      viewCrs: true,
      create: true,
      merge: true,
      manage: true,
    });
  });

  it('follows the grants of a member', () => {
    const viewer = subject({ id: 'ha', grants: grants('viewMain') });
    expect(can(viewer, 'viewMain')).toBe(true);
    expect(can(viewer, 'viewCrs')).toBe(false);
    expect(can(viewer, 'create')).toBe(false);
    const merger = subject({ id: 'quang', grants: grants('mergeCrs') });
    expect(rightsOf(merger)).toEqual({
      viewMain: true,
      viewCrs: true,
      create: false,
      merge: true,
      manage: false,
    });
    expect(can(subject({ id: 'x', grants: NO_GRANTS }), 'viewMain')).toBe(false);
  });

  it('lets a team lead always create change requests', () => {
    const lead = subject({ id: 'lan', grants: NO_GRANTS }, [null, 'lan']);
    expect(rightsOf(lead)).toEqual({
      viewMain: true,
      viewCrs: true,
      create: true,
      merge: false,
      manage: false,
    });
  });

  it('lets a reader with no member row read Main and change requests only', () => {
    expect(rightsOf(subject(null))).toEqual({
      viewMain: true,
      viewCrs: true,
      create: false,
      merge: false,
      manage: false,
    });
  });

  it('edits a change request with the create right and a part in it', () => {
    const member = subject({ id: 'ha', grants: DEFAULT_GRANTS });
    const cr = { author: 'lan', editor: 'lan', shares: [{ memberId: 'ha', permission: 'edit' }] };
    expect(can(member, 'edit')).toBe(true);
    expect(can(member, 'edit', cr)).toBe(true);
    expect(can(member, 'edit', { ...cr, shares: [{ memberId: 'ha', permission: 'view' }] })).toBe(
      false,
    );
    expect(can(member, 'edit', { author: 'ha', editor: 'lan', shares: [] })).toBe(true);
    const viewer = subject({ id: 'ha', grants: grants('viewMain', 'viewCrs') });
    expect(can(viewer, 'edit', cr)).toBe(false);
    expect(can(viewer, 'edit')).toBe(false);
  });
});

describe('canSeeCr', () => {
  const cr = (status: string, shares: Array<{ memberId: string; permission: string }> = []) => ({
    author: 'lan',
    editor: 'lan',
    status,
    shares,
  });
  it('shows a member without the list only merged ones and the ones shared with them', () => {
    const viewer = subject({ id: 'ha', grants: grants('viewMain') });
    expect(canSeeCr(viewer, cr('merged'))).toBe(true);
    expect(canSeeCr(viewer, cr('draft'))).toBe(false);
    expect(canSeeCr(viewer, cr('ready', [{ memberId: 'ha', permission: 'view' }]))).toBe(true);
    expect(canSeeCr(subject({ id: 'ha', grants: NO_GRANTS }), cr('merged'))).toBe(false);
    expect(canSeeCr(subject({ id: 'ha', grants: grants('viewCrs') }), cr('closed'))).toBe(true);
  });
});

describe('mergerIds', () => {
  it('lists the present members who may merge, the project lead first', () => {
    const member = (id: string, g: Grants, active = true) => ({ id, grants: g, active });
    expect(
      mergerIds({
        ...subject(null, [], 'minh'),
        members: [
          member('quang', grants('mergeCrs')),
          member('minh', NO_GRANTS),
          member('lan', DEFAULT_GRANTS),
          member('gone', grants('mergeCrs'), false),
        ],
      }),
    ).toEqual(['minh', 'quang']);
  });
});
