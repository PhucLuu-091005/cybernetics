import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configurePhotoStore } from '../../../src/server/avatars/config';
import { LocalPhotoStore } from '../../../src/server/avatars/store';
import { users } from '../../../src/server/db/schema';
import {
  addQueueEntry,
  appendOp,
  createCr,
  crAction,
  dismissQueueEntry,
  getTrackerPayload,
  getTrackerVersion,
  removeOp,
  updateMember,
  updateTeam,
} from '../../../src/server/tracker';
import type { TrackerPayload } from '../../../src/tracker';
import { changedParts } from '../../../src/tracker';
import { createTestDatabase, type TestDb } from '../../support/db';
import { seedDemo, type Demo } from '../../support/tracker-db';

describe.skipIf(!process.env.TEST_DATABASE_URL)('tracker version', () => {
  let t: TestDb, demo: Demo;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.close();
  });
  const as = (key: string) => ({ projectId: demo.projectId, actAs: demo.ids[key] });
  const versionOf = (key = 'minh') => getTrackerVersion(t.db, demo.owner, as(key));
  /** Runs a write as another member and returns the parts of Minh's version that changed. */
  const changedBy = async (write: () => Promise<unknown>, key = 'minh') => {
    const before = await versionOf(key);
    await write();
    const after = await versionOf(key);
    return { parts: changedParts(before.version, after.version), before, after };
  };

  it('matches the version of the full payload and stays the same on a read', async () => {
    demo = await seedDemo(t.db);
    const first = await versionOf();
    const payload = await getTrackerPayload(t.db, demo.owner, as('minh'));
    expect(payload.version).toBe(first.version);
    expect(first.crCount).toBe(payload.crs.length);
    expect((await versionOf()).version).toBe(first.version);
    expect(first.version.split('.')).toHaveLength(4);
  });

  it('changes the change request part and the count when another person opens a change request', async () => {
    demo = await seedDemo(t.db);
    let num = 0;
    const { parts, before, after } = await changedBy(async () => {
      num = (await createCr(t.db, demo.owner, { ...as('lan'), title: 'Root cause' })).num;
    });
    expect(parts).toEqual(['crs']);
    expect(after.crCount).toBe(before.crCount + 1);
    const op = { op: 'attach', a: { eventId: demo.ids.qe1, workItemId: 'incident' } } as const;
    expect(
      (
        await changedBy(() =>
          appendOp(t.db, demo.owner, { ...as('lan'), num, expectedRevision: 0, op }),
        )
      ).parts,
    ).toEqual(['crs']);
    expect(
      (
        await changedBy(() =>
          crAction(t.db, demo.owner, { ...as('lan'), num, action: 'comment', body: 'Look.' }),
        )
      ).parts,
    ).toEqual(['crs']);
  });

  it('changes the Main part on a merge and the Queue part on a new card', async () => {
    demo = await seedDemo(t.db);
    const payload = await getTrackerPayload(t.db, demo.owner, as('minh'));
    const two = payload.crs.find((cr) => cr.num === 2)!;
    const merged = await changedBy(() =>
      crAction(t.db, demo.owner, {
        ...as('quang'),
        num: 2,
        action: 'merge',
        expectedRevision: two.revision,
      }),
    );
    expect(merged.parts).toContain('main');
    const queued = await changedBy(() =>
      addQueueEntry(t.db, demo.owner, {
        ...as('lan'),
        kind: 'event',
        fields: { kind: 'message', at: '2026-10-09T17:00:00+07:00', by: 'sarah', text: 'Call.' },
      }),
    );
    expect(queued.parts).toEqual(['queue']);
  });

  it('changes the project part when the members or the teams change', async () => {
    demo = await seedDemo(t.db);
    expect(
      (
        await changedBy(() =>
          updateTeam(t.db, demo.owner, { ...as('minh'), teamId: 'digitization', name: 'Scan' }),
        )
      ).parts,
    ).toEqual(['project']);
    expect(
      (
        await changedBy(() =>
          updateMember(t.db, demo.owner, {
            ...as('minh'),
            memberId: demo.ids.khoa,
            grants: { viewMain: true, viewCrs: true, createCrs: false, mergeCrs: false },
          }),
        )
      ).parts,
    ).toEqual(['project']);
  });

  it('stays the same for a member who cannot see the new change request', async () => {
    demo = await seedDemo(t.db);
    await updateMember(t.db, demo.owner, {
      ...as('minh'),
      memberId: demo.ids.khoa,
      grants: { viewMain: true, viewCrs: false, createCrs: false, mergeCrs: false },
    });
    const { parts, before, after } = await changedBy(
      () => createCr(t.db, demo.owner, { ...as('lan'), title: 'Private draft' }),
      'khoa',
    );
    expect(parts).toEqual([]);
    expect(after.crCount).toBe(before.crCount);
  });

  /** The payload a write returns must carry the version a check reads right after it. */
  const sameAsCheck = async (payload: TrackerPayload, key: string) =>
    expect(payload.version).toBe((await versionOf(key)).version);
  const revisionOf = async (num: number) =>
    (await getTrackerPayload(t.db, demo.owner, as('minh'))).crs.find((cr) => cr.num === num)!
      .revision;
  const action = (key: string, num: number, body: Record<string, unknown>) =>
    crAction(t.db, demo.owner, { ...as(key), num, ...body } as Parameters<typeof crAction>[2]);

  it('gives a write the version of the next check, also after a merge that adds a team', async () => {
    demo = await seedDemo(t.db);
    const { num } = await createCr(t.db, demo.owner, {
      ...as('lan'),
      title: 'Legal team',
      ops: [{ op: 'addTeam', a: { id: 'legal', name: 'Legal', leadId: null } }],
    });
    await action('lan', num, { action: 'ready' });
    const merged = await action('minh', num, {
      action: 'merge',
      expectedRevision: await revisionOf(num),
    });
    expect(merged.base.teams.map((team) => team.id)).toContain('legal');
    await sameAsCheck(merged, 'minh');
    await sameAsCheck(
      await action('ha', 4, { action: 'share', memberId: demo.ids.lan, permission: 'edit' }),
      'ha',
    );
    await sameAsCheck(await action('khoa', 4, { action: 'ask' }), 'khoa');
    await sameAsCheck(await action('ha', 4, { action: 'handover', to: demo.ids.khoa }), 'ha');
    await sameAsCheck(
      await removeOp(t.db, demo.owner, {
        ...as('khoa'),
        num: 4,
        index: 'last',
        expectedRevision: await revisionOf(4),
      }),
      'khoa',
    );
  });

  it('moves for shares, asks, hand-overs, a removed change and a dismissed card', async () => {
    demo = await seedDemo(t.db);
    const crs = (write: () => Promise<unknown>) =>
      changedBy(write).then((changed) => changed.parts);
    expect(
      await crs(() =>
        action('ha', 4, { action: 'share', memberId: demo.ids.lan, permission: 'view' }),
      ),
    ).toEqual(['crs']);
    expect(await crs(() => action('khoa', 4, { action: 'ask' }))).toEqual(['crs']);
    expect(await crs(() => action('ha', 4, { action: 'handover', to: demo.ids.khoa }))).toEqual([
      'crs',
    ]);
    const revision = await revisionOf(4);
    expect(
      await crs(() =>
        removeOp(t.db, demo.owner, {
          ...as('khoa'),
          num: 4,
          index: 'last',
          expectedRevision: revision,
        }),
      ),
    ).toEqual(['crs']);
    const card = (
      await addQueueEntry(t.db, demo.owner, {
        ...as('lan'),
        kind: 'event',
        fields: { kind: 'message', at: '2026-10-09T17:00:00+07:00', by: 'sarah', text: 'Call.' },
      })
    ).queue.events.at(-1)!;
    expect(
      await crs(() => dismissQueueEntry(t.db, demo.owner, { ...as('lan'), queueId: card.id })),
    ).toEqual(['queue']);
  });

  it('moves the project part for a lead hand-over and a new photo', async () => {
    demo = await seedDemo(t.db);
    expect(
      (
        await changedBy(() =>
          updateMember(t.db, demo.owner, {
            ...as('minh'),
            memberId: demo.ids.lan,
            projectLead: true,
          }),
        )
      ).parts,
    ).toEqual(['project']);
    configurePhotoStore(new LocalPhotoStore(join(tmpdir(), 'pg-version-photos')));
    try {
      const photo = await changedBy(() =>
        t.db
          .update(users)
          .set({ avatarKey: `avatars/${demo.owner.userId}/${'a'.repeat(64)}.webp` })
          .where(eq(users.id, demo.owner.userId)),
      );
      expect(photo.parts).toEqual(['project']);
    } finally {
      configurePhotoStore(undefined);
    }
  });

  it('gives the revision of the change request on screen, when asked', async () => {
    demo = await seedDemo(t.db);
    const before = await getTrackerVersion(t.db, demo.owner, { ...as('minh'), num: 4 });
    const cr = (await getTrackerPayload(t.db, demo.owner, as('minh'))).crs.find(
      (c) => c.num === 4,
    )!;
    expect(before.cr).toEqual({ num: 4, revision: cr.revision, updatedAt: cr.updatedAt });
    await action('khoa', 4, { action: 'ask' });
    const after = await getTrackerVersion(t.db, demo.owner, { ...as('minh'), num: 4 });
    expect(after.cr?.revision).toBe(cr.revision);
    expect(after.cr?.updatedAt).not.toBe(cr.updatedAt);
    expect((await getTrackerVersion(t.db, demo.owner, { ...as('minh'), num: 99 })).cr).toBeNull();
    expect((await versionOf()).cr).toBeUndefined();
  });
});
