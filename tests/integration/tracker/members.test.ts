import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { DbIdentityStore } from '../../../src/server/db/identity-store';
import { agentTokens, trackerCrShares } from '../../../src/server/db/schema';
import { createEmptyProject, listProjects } from '../../../src/server/domain/projects';
import {
  changeMemberRole,
  createCr,
  crAction,
  getTrackerPayload,
  inviteMember,
  listProjectMembers,
  removeMember,
} from '../../../src/server/tracker';
import { agentActor, createTestDatabase, testActor, type TestDb } from '../../support/db';
import { seedDemo, type Demo } from '../../support/tracker-db';

describe.skipIf(!process.env.TEST_DATABASE_URL)('project members', () => {
  let t: TestDb;
  let demo: Demo;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.close();
  });
  const fresh = async () => {
    demo = await seedDemo(t.db);
    // A second project in the owner's workspace that an invite must not open.
    await createEmptyProject(t.db, demo.owner, {
      title: 'Other project',
      clientName: 'Other client',
      teams: ['Engineering'],
    });
  };
  const as = (key: string) => ({ projectId: demo.projectId, actAs: demo.ids[key] });
  const own = () => ({ projectId: demo.projectId });
  const email = () => `person-${randomUUID().slice(0, 8)}@example.com`;
  const signIn = (address: string, name = 'Invited Person') =>
    testActor(t.db, { subject: `google:${randomUUID()}`, email: address, name });

  it('lists every member with the owner first-class and lets the owner manage', async () => {
    await fresh();
    const list = await listProjectMembers(t.db, demo.owner, own());
    expect(list.canManage).toBe(true);
    expect(list.members.map((m) => [m.name, m.role, m.pending])).toEqual([
      ['Minh Trần', 'owner', false],
      ['Lan Phạm', 'member', false],
      ['Quang Nguyễn', 'member', false],
      ['Hà Đỗ', 'member', false],
      ['Khoa Lê', 'member', false],
    ]);
    expect(list.members.find((m) => m.you)?.name).toBe('Minh Trần');
    const lan = await listProjectMembers(t.db, demo.owner, as('lan'));
    expect(lan.canManage).toBe(false);
    expect(lan.members.find((m) => m.you)?.name).toBe('Lan Phạm');
  });

  it('keeps an invite pending until that address signs in, then opens only this project', async () => {
    await fresh();
    const address = email();
    const invited = await inviteMember(t.db, demo.owner, {
      ...own(),
      email: `  ${address.toUpperCase()} `,
      role: 'member',
    });
    const row = invited.members.find((m) => m.email === address)!;
    expect(row).toMatchObject({ name: address, role: 'member', pending: true });
    const before = await getTrackerPayload(t.db, demo.owner, own());
    expect(before.members.find((m) => m.id === row.id)?.active).toBe(false);

    const person = await signIn(address, 'Mai Vũ');
    const projects = await listProjects(t.db, person);
    expect(projects.map((p) => p.id)).toEqual([demo.projectId]);
    const payload = await getTrackerPayload(t.db, person, own());
    expect(payload.me).toMatchObject({ id: row.id, name: 'Mai Vũ', active: true });
    const { num } = await createCr(t.db, person, { ...own(), title: 'From Mai' });
    expect(num).toBe(5);
    const after = await listProjectMembers(t.db, demo.owner, own());
    expect(after.members.find((m) => m.id === row.id)).toMatchObject({
      name: 'Mai Vũ',
      email: address,
      pending: false,
    });
  });

  it('links an existing account at once and refuses a second invite of the same person', async () => {
    await fresh();
    const address = email();
    const person = await signIn(address, 'Tú Hồ');
    const invited = await inviteMember(t.db, demo.owner, {
      ...own(),
      email: address,
      role: 'viewer',
    });
    expect(invited.members.find((m) => m.email === address)).toMatchObject({
      name: 'Tú Hồ',
      role: 'viewer',
      pending: false,
    });
    const payload = await getTrackerPayload(t.db, person, own());
    expect(payload.me).toBeNull();
    await expect(createCr(t.db, person, { ...own(), title: 'No' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      inviteMember(t.db, demo.owner, { ...own(), email: address.toUpperCase(), role: 'member' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a bad address, an unknown role and extra fields', async () => {
    await fresh();
    for (const body of [
      { email: 'not-an-email', role: 'member' },
      { email: email(), role: 'owner' },
      { email: email(), role: 'member', userId: randomUUID() },
    ])
      await expect(
        inviteMember(t.db, demo.owner, { ...own(), ...body } as never),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('lets only the owner invite, change a role or remove; an agent can do none of it', async () => {
    await fresh();
    const forbidden = { code: 'FORBIDDEN' };
    await expect(
      inviteMember(t.db, demo.owner, { ...as('lan'), email: email(), role: 'member' }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      changeMemberRole(t.db, demo.owner, { ...as('lan'), memberId: demo.ids.khoa, role: 'viewer' }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      removeMember(t.db, demo.owner, { ...as('lan'), memberId: demo.ids.khoa }),
    ).rejects.toMatchObject(forbidden);
    const agent = agentActor(demo.owner, demo.projectId, ['project:read', 'queue:add']);
    await expect(
      inviteMember(t.db, agent, { ...own(), email: email(), role: 'member' }),
    ).rejects.toMatchObject(forbidden);
  });

  it('keeps the owner: no removal of themself and no role change without a new owner', async () => {
    await fresh();
    await expect(
      removeMember(t.db, demo.owner, { ...own(), memberId: demo.ids.minh }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      changeMemberRole(t.db, demo.owner, { ...own(), memberId: demo.ids.minh, role: 'member' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('makes a viewer read-only and keeps the demo act-as to people who can act', async () => {
    await fresh();
    const list = await changeMemberRole(t.db, demo.owner, {
      ...own(),
      memberId: demo.ids.khoa,
      role: 'viewer',
    });
    expect(list.members.find((m) => m.id === demo.ids.khoa)?.role).toBe('viewer');
    await expect(getTrackerPayload(t.db, demo.owner, as('khoa'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const payload = await getTrackerPayload(t.db, demo.owner, as('lan'));
    expect(payload.me?.name).toBe('Lan Phạm');
    await changeMemberRole(t.db, demo.owner, { ...own(), memberId: demo.ids.khoa, role: 'member' });
    expect((await getTrackerPayload(t.db, demo.owner, as('khoa'))).me?.name).toBe('Khoa Lê');
  });

  it('removes a member: their open drafts go back to the author or the owner, and history keeps the name', async () => {
    await fresh();
    const before = await getTrackerPayload(t.db, demo.owner, own());
    const hasDraft = before.crs.find((c) => c.num === 4)!;
    expect(hasDraft.editor).toBe(demo.ids.ha);
    await removeMember(t.db, demo.owner, { ...own(), memberId: demo.ids.ha });
    const after = await getTrackerPayload(t.db, demo.owner, own());
    expect(after.crs.find((c) => c.num === 4)?.editor).toBe(demo.ids.minh);
    expect(after.members.find((m) => m.id === demo.ids.ha)).toMatchObject({
      name: 'Hà Đỗ',
      active: false,
    });
    const list = await listProjectMembers(t.db, demo.owner, own());
    expect(list.members.map((m) => m.name)).not.toContain('Hà Đỗ');
    await expect(getTrackerPayload(t.db, demo.owner, as('ha'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('closes the project to a removed person, and a new invite brings the same member back', async () => {
    await fresh();
    const address = email();
    const person = await signIn(address);
    const invited = await inviteMember(t.db, demo.owner, {
      ...own(),
      email: address,
      role: 'member',
    });
    const id = invited.members.find((m) => m.email === address)!.id;
    await removeMember(t.db, demo.owner, { ...own(), memberId: id });
    await expect(getTrackerPayload(t.db, person, own())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await listProjects(t.db, person)).toEqual([]);
    const again = await inviteMember(t.db, demo.owner, {
      ...own(),
      email: address,
      role: 'member',
    });
    expect(again.members.find((m) => m.email === address)?.id).toBe(id);
    expect((await getTrackerPayload(t.db, person, own())).me?.id).toBe(id);
  });

  it('hands Main to a new owner, who then manages the members alone', async () => {
    await fresh();
    const list = await changeMemberRole(t.db, demo.owner, {
      ...own(),
      memberId: demo.ids.lan,
      role: 'owner',
    });
    expect(list.members.find((m) => m.id === demo.ids.lan)?.role).toBe('owner');
    expect(list.members.find((m) => m.id === demo.ids.minh)?.role).toBe('member');
    expect(list.canManage).toBe(false);
    const payload = await getTrackerPayload(t.db, demo.owner, own());
    expect(payload.project.ownerMemberId).toBe(demo.ids.lan);
    await expect(
      inviteMember(t.db, demo.owner, { ...own(), email: email(), role: 'member' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await listProjectMembers(t.db, demo.owner, as('lan'))).canManage).toBe(true);
  });

  it('cannot give Main to an invite that waits for a sign-in', async () => {
    await fresh();
    const address = email();
    const invited = await inviteMember(t.db, demo.owner, {
      ...own(),
      email: address,
      role: 'member',
    });
    const id = invited.members.find((m) => m.email === address)!.id;
    await expect(
      changeMemberRole(t.db, demo.owner, { ...own(), memberId: id, role: 'owner' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('links an invite on a later sign-in of an account that already exists', async () => {
    await fresh();
    const address = email();
    const subject = `google:${randomUUID()}`;
    const store = new DbIdentityStore(t.db);
    const { userId } = await store.provisionUser({ subject, email: null, name: 'Later Person' });
    await inviteMember(t.db, demo.owner, { ...own(), email: address, role: 'member' });
    await store.provisionUser({ subject, email: address, name: 'Later Person' });
    const list = await listProjectMembers(t.db, demo.owner, own());
    const row = list.members.find((m) => m.email === address)!;
    expect(row).toMatchObject({ name: 'Later Person', pending: false });
    const projects = await listProjects(t.db, { ...demo.owner, userId, requestId: randomUUID() });
    expect(projects.map((p) => p.id)).toContain(demo.projectId);
  });
  it('gives an invited person the project in the identity store, so their agent tokens work until removal', async () => {
    await fresh();
    const address = email();
    const person = await signIn(address);
    const store = new DbIdentityStore(t.db);
    expect(await store.resolveProject(person.userId, demo.projectId)).toBeNull();
    const invited = await inviteMember(t.db, demo.owner, {
      ...own(),
      email: address,
      role: 'member',
    });
    expect(await store.resolveProject(person.userId, demo.projectId)).toEqual({
      workspaceId: demo.workspaceId,
      projectId: demo.projectId,
    });
    const id = invited.members.find((m) => m.email === address)!.id;
    await removeMember(t.db, demo.owner, { ...own(), memberId: id });
    expect(await store.resolveProject(person.userId, demo.projectId)).toBeNull();
  });
  it('lets only the person of the sandbox work as another member; an invited person works as themself', async () => {
    await fresh();
    const address = email();
    const person = await signIn(address);
    await inviteMember(t.db, demo.owner, { ...own(), email: address, role: 'member' });
    expect((await getTrackerPayload(t.db, demo.owner, own())).canActAs).toBe(true);
    const payload = await getTrackerPayload(t.db, person, own());
    expect(payload.canActAs).toBe(false);
    await expect(getTrackerPayload(t.db, person, as('minh'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
  it('refuses to share a change request with a viewer, and answers a double invite with CONFLICT', async () => {
    await fresh();
    await changeMemberRole(t.db, demo.owner, { ...own(), memberId: demo.ids.khoa, role: 'viewer' });
    await expect(
      crAction(t.db, demo.owner, {
        ...as('ha'),
        num: 4,
        action: 'share',
        memberId: demo.ids.khoa,
        permission: 'view',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const address = email();
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        inviteMember(t.db, demo.owner, { ...own(), email: address, role: 'member' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason,
    ).toMatchObject({ code: 'CONFLICT' });
  });
  it('lets the sandbox person work as a seeded member, never as an invited person', async () => {
    await fresh();
    const address = email();
    const person = await signIn(address);
    const invited = await inviteMember(t.db, demo.owner, {
      ...own(),
      email: address,
      role: 'member',
    });
    const id = invited.members.find((m) => m.email === address)!.id;
    await expect(
      getTrackerPayload(t.db, demo.owner, { ...own(), actAs: id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await changeMemberRole(t.db, demo.owner, { ...own(), memberId: id, role: 'owner' });
    await expect(
      changeMemberRole(t.db, demo.owner, {
        ...own(),
        actAs: id,
        memberId: demo.ids.minh,
        role: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await listProjectMembers(t.db, person, own())).canManage).toBe(true);
  });

  it('closes the project to a removed person even through the workspace', async () => {
    await fresh();
    const address = email();
    const person = await signIn(address);
    const invited = await inviteMember(t.db, demo.owner, {
      ...own(),
      email: address,
      role: 'member',
    });
    const id = invited.members.find((m) => m.email === address)!.id;
    await changeMemberRole(t.db, demo.owner, { ...own(), memberId: id, role: 'owner' });
    await removeMember(t.db, person, { ...own(), memberId: demo.ids.minh });
    await expect(getTrackerPayload(t.db, demo.owner, own())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await listProjects(t.db, demo.owner)).map((p) => p.id)).not.toContain(demo.projectId);
  });

  it('revokes the agent tokens and drops the shares of a removed member', async () => {
    await fresh();
    const address = email();
    const person = await signIn(address);
    const invited = await inviteMember(t.db, demo.owner, {
      ...own(),
      email: address,
      role: 'member',
    });
    const id = invited.members.find((m) => m.email === address)!.id;
    await crAction(t.db, demo.owner, {
      ...as('ha'),
      num: 4,
      action: 'share',
      memberId: id,
      permission: 'edit',
    });
    await t.db.insert(agentTokens).values({
      workspaceId: demo.workspaceId,
      projectId: demo.projectId,
      userId: person.userId,
      prefix: 'inv_test',
      hash: randomUUID(),
      label: 'Agent',
      scopes: ['project:read'],
      idempotencyKey: randomUUID(),
      expiresAt: '2099-01-01T00:00:00Z',
    });
    await removeMember(t.db, demo.owner, { ...own(), memberId: id });
    const tokens = await t.db
      .select()
      .from(agentTokens)
      .where(and(eq(agentTokens.projectId, demo.projectId), eq(agentTokens.userId, person.userId)));
    expect(tokens.every((token) => token.revokedAt !== null)).toBe(true);
    expect(
      await t.db.select().from(trackerCrShares).where(eq(trackerCrShares.memberId, id)),
    ).toEqual([]);
  });

  it('hands the drafts of a new viewer back to the author or the owner', async () => {
    await fresh();
    await crAction(t.db, demo.owner, {
      ...as('ha'),
      num: 4,
      action: 'share',
      memberId: demo.ids.lan,
      permission: 'edit',
    });
    await crAction(t.db, demo.owner, { ...as('ha'), num: 4, action: 'handover', to: demo.ids.lan });
    await changeMemberRole(t.db, demo.owner, { ...own(), memberId: demo.ids.lan, role: 'viewer' });
    const payload = await getTrackerPayload(t.db, demo.owner, own());
    const cr = payload.crs.find((c) => c.num === 4)!;
    expect(cr.editor).toBe(demo.ids.ha);
    expect(cr.shares.map((share) => share.memberId)).not.toContain(demo.ids.lan);
  });

  it('links a new email of a person who was removed, by bringing back their old member', async () => {
    await fresh();
    const first = email();
    const subject = `google:${randomUUID()}`;
    const store = new DbIdentityStore(t.db);
    await store.provisionUser({ subject, email: first, name: 'Moving Person' });
    const invited = await inviteMember(t.db, demo.owner, {
      ...own(),
      email: first,
      role: 'member',
    });
    const id = invited.members.find((m) => m.email === first)!.id;
    await removeMember(t.db, demo.owner, { ...own(), memberId: id });
    const second = email();
    await inviteMember(t.db, demo.owner, { ...own(), email: second, role: 'viewer' });
    await store.provisionUser({ subject, email: second, name: 'Moving Person' });
    const list = await listProjectMembers(t.db, demo.owner, own());
    const rows = list.members.filter((m) => m.email === second || m.id === id);
    expect(rows).toEqual([
      expect.objectContaining({ id, email: second, role: 'viewer', pending: false }),
    ]);
  });
});
