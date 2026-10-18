import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { DbIdentityStore } from '../../../src/server/db/identity-store';
import { agentTokens, trackerCrShares } from '../../../src/server/db/schema';
import { createEmptyProject, listProjects } from '../../../src/server/domain/projects';
import {
  addQueueEntry,
  addTeam,
  createCr,
  crAction,
  deleteTeam,
  getTrackerPayload,
  inviteMember,
  listProjectMembers,
  removeMember,
  updateMember,
  updateTeam,
} from '../../../src/server/tracker';
import {
  ALL_GRANTS,
  DEFAULT_GRANTS,
  NO_GRANTS,
  type Grants,
} from '../../../src/tracker/permissions';
import { agentActor, createTestDatabase, testActor, type TestDb } from '../../support/db';
import { seedDemo, workspaceGuest, type Demo } from '../../support/tracker-db';

const VIEW_MAIN: Grants = { ...NO_GRANTS, viewMain: true };
const VIEW_ALL: Grants = { ...VIEW_MAIN, viewCrs: true };

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
    // A second project in the lead's workspace that an invite must not open.
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
  const grant = (key: string, grants: Grants) =>
    updateMember(t.db, demo.owner, { ...own(), memberId: demo.ids[key], grants });

  it('lists every member with the project lead, grants, rights and teams', async () => {
    await fresh();
    const list = await listProjectMembers(t.db, demo.owner, own());
    expect(list.canManage).toBe(true);
    expect(list.leadId).toBe(demo.ids.minh);
    expect(
      list.members.map((m) => [m.name, m.projectLead, m.rights.create, m.rights.merge, m.pending]),
    ).toEqual([
      ['Minh Trần', true, true, true, false],
      ['Lan Phạm', false, true, false, false],
      ['Quang Nguyễn', false, true, true, false],
      ['Hà Đỗ', false, true, false, false],
      ['Khoa Lê', false, true, false, false],
    ]);
    const teams = Object.fromEntries(list.teams.map((team) => [team.id, team]));
    expect(teams.digitization).toMatchObject({
      name: 'Digitization',
      leadId: demo.ids.lan,
      memberIds: [demo.ids.lan],
    });
    expect(teams['digitization-qa']).toMatchObject({ leadId: null, memberIds: [demo.ids.ha] });
    expect(teams.engineering.workItems).toBeGreaterThan(0);
    expect(teams.engineering.keep).toMatch(/so it stays/);
    expect(list.members.find((m) => m.id === demo.ids.ha)?.teamIds).toEqual(['digitization-qa']);
    const lan = await listProjectMembers(t.db, demo.owner, as('lan'));
    expect(lan.canManage).toBe(false);
    expect(lan.members.find((m) => m.you)?.name).toBe('Lan Phạm');
  });

  it('gives the payload the project lead, the grants and the project team list', async () => {
    await fresh();
    const payload = await getTrackerPayload(t.db, demo.owner, own());
    expect(payload.project.leadMemberId).toBe(demo.ids.minh);
    expect(payload.members.find((m) => m.id === demo.ids.quang)?.grants).toEqual({
      ...DEFAULT_GRANTS,
      mergeCrs: true,
    });
    expect(payload.base.teams.find((team) => team.id === 'engineering')?.leadId).toBe(
      demo.ids.quang,
    );
  });

  it('puts every member, pending invites included, into the people of Main after the story people', async () => {
    await fresh();
    const seeded = (await getTrackerPayload(t.db, demo.owner, own())).base.people;
    expect(seeded).toHaveLength(9);
    const pending = email();
    const joined = email();
    await inviteMember(t.db, demo.owner, { ...own(), email: pending });
    await signIn(joined, 'Mai Vũ');
    const list = await inviteMember(t.db, demo.owner, { ...own(), email: joined });
    const idOf = (address: string) => list.members.find((m) => m.email === address)!.id;

    const payload = await getTrackerPayload(t.db, demo.owner, own());
    expect(payload.base.people).toEqual([
      ...seeded,
      { id: idOf(pending), name: pending },
      { id: idOf(joined), name: 'Mai Vũ' },
    ]);
    const card = {
      ...own(),
      kind: 'item' as const,
      fields: {
        title: 'Check the invoice batch',
        doneBy: idOf(joined),
        requestedBy: idOf(pending),
        plannedFinish: '2026-10-20',
      },
    };
    const added = await addQueueEntry(t.db, demo.owner, card);
    expect(added.queue.items.some((item) => item.title === 'Check the invoice batch')).toBe(true);

    await removeMember(t.db, demo.owner, { ...own(), memberId: idOf(joined) });
    const after = await getTrackerPayload(t.db, demo.owner, own());
    expect(after.base.people.find((p) => p.id === idOf(joined))?.name).toBe('Mai Vũ');
  });

  it('starts a new project with its creator as the one person, with no copy', async () => {
    await fresh();
    const { id } = await createEmptyProject(t.db, demo.owner, {
      title: 'Fresh project',
      clientName: 'Client',
      teams: ['Engineering'],
    });
    const payload = await getTrackerPayload(t.db, demo.owner, { projectId: id });
    expect(payload.base.people).toEqual([{ id: payload.me!.id, name: payload.me!.name }]);
  });

  it('keeps an invite pending until that address signs in, then opens only this project', async () => {
    await fresh();
    const address = email();
    const invited = await inviteMember(t.db, demo.owner, {
      ...own(),
      email: `  ${address.toUpperCase()} `,
    });
    const row = invited.members.find((m) => m.email === address)!;
    expect(row).toMatchObject({ name: address, pending: true, grants: DEFAULT_GRANTS });
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

  it('links an existing account at once with the grants of the invite, and refuses a second invite', async () => {
    await fresh();
    const address = email();
    const person = await signIn(address, 'Tú Hồ');
    const invited = await inviteMember(t.db, demo.owner, {
      ...own(),
      email: address,
      grants: VIEW_MAIN,
    });
    expect(invited.members.find((m) => m.email === address)).toMatchObject({
      name: 'Tú Hồ',
      grants: VIEW_MAIN,
      pending: false,
    });
    const payload = await getTrackerPayload(t.db, person, own());
    expect(payload.me?.name).toBe('Tú Hồ');
    await expect(createCr(t.db, person, { ...own(), title: 'No' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      inviteMember(t.db, demo.owner, { ...own(), email: address.toUpperCase() }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a bad address, a role and extra fields', async () => {
    await fresh();
    for (const body of [
      { email: 'not-an-email' },
      { email: email(), role: 'member' },
      { email: email(), userId: randomUUID() },
      { email: email(), grants: { viewMain: true } },
    ])
      await expect(
        inviteMember(t.db, demo.owner, { ...own(), ...body } as never),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('lets only the project lead invite, grant, remove and change teams; an agent can do none of it', async () => {
    await fresh();
    const forbidden = { code: 'FORBIDDEN' };
    await expect(
      inviteMember(t.db, demo.owner, { ...as('lan'), email: email() }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      updateMember(t.db, demo.owner, {
        ...as('quang'),
        memberId: demo.ids.khoa,
        grants: VIEW_MAIN,
      }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      removeMember(t.db, demo.owner, { ...as('lan'), memberId: demo.ids.khoa }),
    ).rejects.toMatchObject(forbidden);
    await expect(addTeam(t.db, demo.owner, { ...as('lan'), name: 'Legal' })).rejects.toMatchObject(
      forbidden,
    );
    await expect(
      updateTeam(t.db, demo.owner, { ...as('lan'), teamId: 'digitization', name: 'Scan' }),
    ).rejects.toMatchObject(forbidden);
    const agent = agentActor(demo.owner, demo.projectId, ['project:read', 'queue:add']);
    await expect(inviteMember(t.db, agent, { ...own(), email: email() })).rejects.toMatchObject(
      forbidden,
    );
  });

  it('keeps the project lead: no removal of themself and no grants without a new lead', async () => {
    await fresh();
    await expect(
      removeMember(t.db, demo.owner, { ...own(), memberId: demo.ids.minh }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(grant('minh', VIEW_MAIN)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('follows the grants: view only, list of change requests, create, merge', async () => {
    await fresh();
    let list = await grant('khoa', VIEW_MAIN);
    expect(list.members.find((m) => m.id === demo.ids.khoa)?.grants).toEqual(VIEW_MAIN);
    const viewer = await getTrackerPayload(t.db, demo.owner, as('khoa'));
    expect(viewer.me?.name).toBe('Khoa Lê');
    // Hà shared #4 with Khoa, so it stays; the other open ones do not show without the list.
    expect(viewer.crs.map((cr) => [cr.num, cr.status])).toEqual([
      [1, 'merged'],
      [4, 'draft'],
    ]);
    await expect(createCr(t.db, demo.owner, { ...as('khoa'), title: 'No' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      addQueueEntry(t.db, demo.owner, {
        ...as('khoa'),
        kind: 'event',
        fields: { kind: 'message', at: '2026-10-08T03:00:00.000Z', by: demo.ids.khoa, text: 'Hi' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    list = await grant('khoa', { ...NO_GRANTS, createCrs: true });
    expect(list.members.find((m) => m.id === demo.ids.khoa)?.grants).toEqual(DEFAULT_GRANTS);

    list = await grant('lan', { ...NO_GRANTS, mergeCrs: true });
    expect(list.members.find((m) => m.id === demo.ids.lan)?.grants).toEqual({
      ...VIEW_ALL,
      mergeCrs: true,
    });
    const before = await getTrackerPayload(t.db, demo.owner, own());
    const ready = before.crs.find((cr) => cr.num === 2)!;
    await crAction(t.db, demo.owner, {
      ...as('lan'),
      num: 2,
      action: 'close',
      reason: 'Not needed.',
      expectedRevision: ready.revision,
    });
    await expect(
      crAction(t.db, demo.owner, {
        ...as('ha'),
        num: 3,
        action: 'close',
        reason: 'Not needed.',
        expectedRevision: before.crs.find((cr) => cr.num === 3)!.revision,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets a team lead create change requests without the grant', async () => {
    await fresh();
    await grant('lan', VIEW_MAIN);
    const { num } = await createCr(t.db, demo.owner, { ...as('lan'), title: 'Lead work' });
    expect(num).toBe(5);
    const payload = await getTrackerPayload(t.db, demo.owner, as('lan'));
    expect(payload.crs.map((cr) => cr.num)).toContain(3);
    await updateTeam(t.db, demo.owner, { ...own(), teamId: 'digitization', leadId: null });
    await expect(createCr(t.db, demo.owner, { ...as('lan'), title: 'No' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const after = await getTrackerPayload(t.db, demo.owner, own());
    expect(after.crs.find((cr) => cr.num === num)?.editor).toBe(demo.ids.minh);
  });

  it('shows a member with no grant the Members page, never Main', async () => {
    await fresh();
    await grant('khoa', NO_GRANTS);
    await expect(getTrackerPayload(t.db, demo.owner, as('khoa'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
      extras: { details: { reason: 'no-view', lead: 'Minh Trần' } },
    });
    const list = await listProjectMembers(t.db, demo.owner, as('khoa'));
    expect(list.members).toHaveLength(5);
  });

  it('lets a person of the workspace without a member row read Main and change requests only', async () => {
    await fresh();
    const guest = await workspaceGuest(t.db, demo.owner);
    const payload = await getTrackerPayload(t.db, guest, own());
    expect(payload.me).toBeNull();
    expect(payload.crs).toHaveLength(4);
    await expect(createCr(t.db, guest, { ...own(), title: 'No' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('removes a member: their open drafts go back to the author or the lead, teams drop them, history keeps the name', async () => {
    await fresh();
    const before = await getTrackerPayload(t.db, demo.owner, own());
    expect(before.crs.find((c) => c.num === 4)!.editor).toBe(demo.ids.ha);
    await removeMember(t.db, demo.owner, { ...own(), memberId: demo.ids.ha });
    const after = await getTrackerPayload(t.db, demo.owner, own());
    expect(after.crs.find((c) => c.num === 4)?.editor).toBe(demo.ids.minh);
    expect(after.members.find((m) => m.id === demo.ids.ha)).toMatchObject({
      name: 'Hà Đỗ',
      active: false,
    });
    const list = await listProjectMembers(t.db, demo.owner, own());
    expect(list.members.map((m) => m.name)).not.toContain('Hà Đỗ');
    expect(list.teams.find((team) => team.id === 'digitization-qa')?.memberIds).toEqual([]);
    await expect(getTrackerPayload(t.db, demo.owner, as('ha'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('closes the project to a removed person, and a new invite brings the same member back', async () => {
    await fresh();
    const address = email();
    const person = await signIn(address);
    const invited = await inviteMember(t.db, demo.owner, { ...own(), email: address });
    const id = invited.members.find((m) => m.email === address)!.id;
    await removeMember(t.db, demo.owner, { ...own(), memberId: id });
    await expect(getTrackerPayload(t.db, person, own())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await listProjects(t.db, person)).toEqual([]);
    const again = await inviteMember(t.db, demo.owner, { ...own(), email: address });
    expect(again.members.find((m) => m.email === address)?.id).toBe(id);
    expect((await getTrackerPayload(t.db, person, own())).me?.id).toBe(id);
  });

  it('hands the project lead to another member, who then manages alone; the old lead keeps every grant', async () => {
    await fresh();
    const list = await updateMember(t.db, demo.owner, {
      ...own(),
      memberId: demo.ids.lan,
      projectLead: true,
    });
    expect(list.leadId).toBe(demo.ids.lan);
    expect(list.members.find((m) => m.id === demo.ids.minh)).toMatchObject({
      projectLead: false,
      grants: ALL_GRANTS,
      label: '',
    });
    expect(list.canManage).toBe(false);
    const payload = await getTrackerPayload(t.db, demo.owner, own());
    expect(payload.project.leadMemberId).toBe(demo.ids.lan);
    await expect(
      inviteMember(t.db, demo.owner, { ...own(), email: email() }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await listProjectMembers(t.db, demo.owner, as('lan'))).canManage).toBe(true);
  });

  it('cannot make an invite that waits for a sign-in the project lead', async () => {
    await fresh();
    const address = email();
    const invited = await inviteMember(t.db, demo.owner, { ...own(), email: address });
    const id = invited.members.find((m) => m.email === address)!.id;
    await expect(
      updateMember(t.db, demo.owner, { ...own(), memberId: id, projectLead: true }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('links an invite on a later sign-in of an account that already exists', async () => {
    await fresh();
    const address = email();
    const subject = `google:${randomUUID()}`;
    const store = new DbIdentityStore(t.db);
    const { userId } = await store.provisionUser({ subject, email: null, name: 'Later Person' });
    await inviteMember(t.db, demo.owner, { ...own(), email: address });
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
    const invited = await inviteMember(t.db, demo.owner, { ...own(), email: address });
    expect(await store.resolveProject(person.userId, demo.projectId)).toEqual({
      workspaceId: demo.workspaceId,
      projectId: demo.projectId,
    });
    const id = invited.members.find((m) => m.email === address)!.id;
    await removeMember(t.db, demo.owner, { ...own(), memberId: id });
    expect(await store.resolveProject(person.userId, demo.projectId)).toBeNull();
  });

  it('lets an agent add to the Queue only when its person may create change requests', async () => {
    await fresh();
    const address = email();
    const person = await signIn(address);
    await inviteMember(t.db, demo.owner, { ...own(), email: address, grants: VIEW_ALL });
    const agent = {
      ...agentActor(person, demo.projectId, ['project:read', 'queue:add']),
      workspaceId: demo.workspaceId,
    };
    const card = {
      ...own(),
      kind: 'event' as const,
      fields: {
        kind: 'message' as const,
        at: '2026-10-08T03:00:00.000Z',
        by: demo.ids.minh,
        text: 'Hi',
      },
    };
    await expect(addQueueEntry(t.db, agent, card)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const id = (await listProjectMembers(t.db, demo.owner, own())).members.find(
      (m) => m.email === address,
    )!.id;
    await updateMember(t.db, demo.owner, { ...own(), memberId: id, grants: DEFAULT_GRANTS });
    const payload = await addQueueEntry(t.db, agent, card);
    expect(payload.queue.events.some((event) => event.text === 'Hi')).toBe(true);
  });

  it('lets only the person of the sandbox work as another member; an invited person works as themself', async () => {
    await fresh();
    const address = email();
    const person = await signIn(address);
    await inviteMember(t.db, demo.owner, { ...own(), email: address });
    expect((await getTrackerPayload(t.db, demo.owner, own())).canActAs).toBe(true);
    const payload = await getTrackerPayload(t.db, person, own());
    expect(payload.canActAs).toBe(false);
    await expect(getTrackerPayload(t.db, person, as('minh'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('shares edit only with a person who may create, and answers a double invite with CONFLICT', async () => {
    await fresh();
    await grant('lan', VIEW_ALL);
    await updateTeam(t.db, demo.owner, { ...own(), teamId: 'digitization', leadId: null });
    await expect(
      crAction(t.db, demo.owner, {
        ...as('ha'),
        num: 4,
        action: 'share',
        memberId: demo.ids.lan,
        permission: 'edit',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await crAction(t.db, demo.owner, {
      ...as('ha'),
      num: 4,
      action: 'share',
      memberId: demo.ids.lan,
      permission: 'view',
    });
    const address = email();
    const results = await Promise.allSettled(
      [1, 2].map(() => inviteMember(t.db, demo.owner, { ...own(), email: address })),
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
    const invited = await inviteMember(t.db, demo.owner, { ...own(), email: address });
    const id = invited.members.find((m) => m.email === address)!.id;
    await expect(
      getTrackerPayload(t.db, demo.owner, { ...own(), actAs: id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await updateMember(t.db, demo.owner, { ...own(), memberId: id, projectLead: true });
    await expect(
      updateMember(t.db, demo.owner, {
        ...own(),
        actAs: id,
        memberId: demo.ids.minh,
        projectLead: true,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await listProjectMembers(t.db, person, own())).canManage).toBe(true);
  });

  it('closes the project to a removed person even through the workspace', async () => {
    await fresh();
    const address = email();
    const person = await signIn(address);
    const invited = await inviteMember(t.db, demo.owner, { ...own(), email: address });
    const id = invited.members.find((m) => m.email === address)!.id;
    await updateMember(t.db, demo.owner, { ...own(), memberId: id, projectLead: true });
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
    const invited = await inviteMember(t.db, demo.owner, { ...own(), email: address });
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

  it('hands the drafts of a person who loses the create right back to the author', async () => {
    await fresh();
    await crAction(t.db, demo.owner, {
      ...as('ha'),
      num: 4,
      action: 'share',
      memberId: demo.ids.khoa,
      permission: 'edit',
    });
    await crAction(t.db, demo.owner, {
      ...as('ha'),
      num: 4,
      action: 'handover',
      to: demo.ids.khoa,
    });
    await grant('khoa', VIEW_ALL);
    const payload = await getTrackerPayload(t.db, demo.owner, own());
    expect(payload.crs.find((c) => c.num === 4)!.editor).toBe(demo.ids.ha);
  });

  it('links a new email of a person who was removed, by bringing back their old member with the new grants and teams', async () => {
    await fresh();
    const first = email();
    const subject = `google:${randomUUID()}`;
    const store = new DbIdentityStore(t.db);
    await store.provisionUser({ subject, email: first, name: 'Moving Person' });
    const invited = await inviteMember(t.db, demo.owner, { ...own(), email: first });
    const id = invited.members.find((m) => m.email === first)!.id;
    await removeMember(t.db, demo.owner, { ...own(), memberId: id });
    const second = email();
    const pending = await inviteMember(t.db, demo.owner, {
      ...own(),
      email: second,
      grants: VIEW_MAIN,
    });
    const inviteId = pending.members.find((m) => m.email === second)!.id;
    await updateTeam(t.db, demo.owner, { ...own(), teamId: 'it', leadId: inviteId });
    await store.provisionUser({ subject, email: second, name: 'Moving Person' });
    const list = await listProjectMembers(t.db, demo.owner, own());
    const rows = list.members.filter((m) => m.email === second || m.id === id);
    expect(rows).toEqual([
      expect.objectContaining({ id, email: second, grants: VIEW_MAIN, pending: false }),
    ]);
    expect(list.teams.find((team) => team.id === 'it')).toMatchObject({
      leadId: id,
      memberIds: [id],
    });
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('project teams', () => {
  let t: TestDb;
  let demo: Demo;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.close();
  });
  const own = () => ({ projectId: demo.projectId });
  const as = (key: string) => ({ projectId: demo.projectId, actAs: demo.ids[key] });

  it('adds, renames and deletes a team, and Main shows the new list at once', async () => {
    demo = await seedDemo(t.db);
    let list = await addTeam(t.db, demo.owner, { ...own(), name: '  Legal ' });
    const legal = list.teams.at(-1)!;
    expect(legal).toMatchObject({ name: 'Legal', leadId: null, memberIds: [], keep: null });
    await expect(addTeam(t.db, demo.owner, { ...own(), name: 'legal' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    list = await updateTeam(t.db, demo.owner, { ...own(), teamId: 'it', name: 'IT and Security' });
    const payload = await getTrackerPayload(t.db, demo.owner, own());
    expect(payload.base.teams.map((team) => team.name)).toContain('IT and Security');
    expect(payload.base.teams.map((team) => team.name)).toContain('Legal');
    list = await deleteTeam(t.db, demo.owner, { ...own(), teamId: legal.id });
    expect(list.teams.map((team) => team.name)).not.toContain('Legal');
  });

  it('keeps a team that has work items or that a change request names, and says why', async () => {
    demo = await seedDemo(t.db);
    await expect(
      deleteTeam(t.db, demo.owner, { ...own(), teamId: 'engineering' }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/so it stays/) });
    const list = await listProjectMembers(t.db, demo.owner, own());
    const empty = list.teams.filter((team) => !team.keep);
    expect(empty.every((team) => team.workItems === 0)).toBe(true);
  });

  it('sets team members and a lead; the lead is always a member, and leaving the team ends the lead', async () => {
    demo = await seedDemo(t.db);
    let list = await updateTeam(t.db, demo.owner, {
      ...own(),
      teamId: 'it',
      memberIds: [demo.ids.khoa],
      leadId: demo.ids.ha,
    });
    expect(list.teams.find((team) => team.id === 'it')).toMatchObject({
      leadId: demo.ids.ha,
      memberIds: [demo.ids.ha, demo.ids.khoa],
    });
    list = await updateTeam(t.db, demo.owner, {
      ...own(),
      teamId: 'it',
      memberIds: [demo.ids.khoa],
    });
    expect(list.teams.find((team) => team.id === 'it')).toMatchObject({
      leadId: null,
      memberIds: [demo.ids.khoa],
    });
    await expect(
      updateTeam(t.db, demo.owner, { ...own(), teamId: 'it', memberIds: [randomUUID()] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      updateTeam(t.db, demo.owner, { ...own(), teamId: 'nope', name: 'X' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('makes a team that a merged change request adds a project team', async () => {
    demo = await seedDemo(t.db);
    const owner = demo.owner;
    const { num } = await createCr(t.db, owner, {
      ...own(),
      title: 'Legal team',
      ops: [{ op: 'addTeam', a: { id: 'legal', name: 'Legal', leadId: demo.ids.lan } }],
    });
    const ready = await crAction(t.db, owner, { ...own(), num, action: 'ready' });
    const revision = ready.crs.find((cr) => cr.num === num)!.revision;
    await crAction(t.db, owner, {
      ...own(),
      num,
      action: 'merge',
      picks: {},
      expectedRevision: revision,
    });
    const merged = await getTrackerPayload(t.db, owner, own());
    expect(merged.base.teams.find((team) => team.id === 'legal')).toMatchObject({
      name: 'Legal',
      leadId: null,
    });
    await updateTeam(t.db, owner, { ...own(), teamId: 'legal', name: 'Legal and Compliance' });
    const payload = await getTrackerPayload(t.db, owner, own());
    expect(payload.base.teams.filter((team) => team.id === 'legal')).toEqual([
      { id: 'legal', name: 'Legal and Compliance', leadId: null },
    ]);
  });

  it('never makes a team lead through a merge, so a merger cannot give the create right', async () => {
    demo = await seedDemo(t.db);
    await updateMember(t.db, demo.owner, { ...own(), memberId: demo.ids.ha, grants: VIEW_ALL });
    const { num } = await createCr(t.db, demo.owner, {
      ...as('lan'),
      title: 'Legal team',
      ops: [{ op: 'addTeam', a: { id: 'legal', name: 'Legal', leadId: demo.ids.ha } }],
    });
    const ready = await crAction(t.db, demo.owner, { ...as('lan'), num, action: 'ready' });
    await crAction(t.db, demo.owner, {
      ...as('quang'),
      num,
      action: 'merge',
      picks: {},
      expectedRevision: ready.crs.find((cr) => cr.num === num)!.revision,
    });
    const list = await listProjectMembers(t.db, demo.owner, own());
    expect(list.teams.find((team) => team.id === 'legal')).toMatchObject({ leadId: null });
    expect(list.members.find((m) => m.id === demo.ids.ha)?.rights.create).toBe(false);
    await expect(
      createCr(t.db, demo.owner, { ...as('ha'), title: 'Not allowed' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
