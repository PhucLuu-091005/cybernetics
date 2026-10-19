import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { personOnScreen } from '../../../src/server/domain/account';
import { createEmptyProject } from '../../../src/server/domain/projects';
import { inviteMember, listProjectMembers } from '../../../src/server/tracker';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { seedDemo, workspaceGuest, type Demo } from '../../support/tracker-db';

describe.skipIf(!process.env.TEST_DATABASE_URL)('the person on screen', () => {
  let t: TestDb;
  let demo: Demo;
  beforeAll(async () => {
    t = await createTestDatabase();
    demo = await seedDemo(t.db);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('is the seeded person the visitor of a demo copy acts as', async () => {
    const quang = await personOnScreen(t.db, demo.owner, demo.projectId, demo.ids.quang);
    expect(quang).toMatchObject({
      actAs: demo.ids.quang,
      seeded: true,
      member: { id: demo.ids.quang, name: 'Quang Nguyễn' },
      account: { name: 'Quang Nguyễn', detail: 'Engineering lead', color: '#2563eb' },
    });
  });

  it('is the own member without a cookie, with a stale cookie, or with a cookie for the own member', async () => {
    for (const cookie of [undefined, randomUUID(), 'not-an-id', demo.ids.minh]) {
      const own = await personOnScreen(t.db, demo.owner, demo.projectId, cookie);
      expect(own).toMatchObject({
        seeded: false,
        member: { id: demo.ids.minh, name: 'Minh Trần' },
        account: { name: 'Minh Trần', detail: 'Project lead' },
      });
      expect(own.actAs).toBe(cookie === demo.ids.minh ? cookie : undefined);
    }
  });

  it('never plays a pending invitee, who has no account yet, as a seeded person', async () => {
    const email = `${randomUUID()}@example.com`;
    const invited = await inviteMember(t.db, demo.owner, { projectId: demo.projectId, email });
    const pending = invited.members.find((m) => m.email === email)!;
    expect(pending.pending).toBe(true);
    const seen = await personOnScreen(t.db, demo.owner, demo.projectId, pending.id);
    expect(seen).toMatchObject({ actAs: undefined, seeded: false, member: { id: demo.ids.minh } });
  });

  it('never lets an invited person of a demo copy act as another member', async () => {
    const email = `${randomUUID()}@example.com`;
    const guest = await testActor(t.db, { email, name: 'Invited Person' });
    await inviteMember(t.db, demo.owner, { projectId: demo.projectId, email });
    const seen = await personOnScreen(t.db, guest, demo.projectId, demo.ids.quang);
    expect(seen).toMatchObject({ actAs: undefined, seeded: false });
    expect(seen.member?.userId).toBe(guest.userId);
  });

  it('gives a person with no member their signed-in name, who can only view', async () => {
    const guest = await workspaceGuest(t.db, demo.owner);
    const seen = await personOnScreen(t.db, guest, demo.projectId, demo.ids.quang);
    expect(seen).toMatchObject({ actAs: undefined, seeded: false, member: null });
    expect(seen.account).toMatchObject({ name: 'Guest', detail: 'Can view' });
  });

  it('grants nothing with an act-as cookie in a project that is not a demo copy', async () => {
    const owner = await testActor(t.db, { name: 'Real Lead' });
    const project = await createEmptyProject(t.db, owner, {
      title: 'Fund IV onboarding',
      clientName: 'Larkspur Capital',
      teams: ['Implementation'],
    });
    const email = `${randomUUID()}@example.com`;
    await inviteMember(t.db, owner, { projectId: project.id, email });
    const other = (await listProjectMembers(t.db, owner, { projectId: project.id })).members.find(
      (m) => m.email === email,
    )!;
    const seen = await personOnScreen(t.db, owner, project.id, other.id);
    expect(seen).toMatchObject({
      actAs: undefined,
      seeded: false,
      member: { name: 'Real Lead' },
      account: { name: 'Real Lead' },
    });
  });
});
