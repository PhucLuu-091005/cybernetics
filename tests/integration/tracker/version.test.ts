import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addQueueEntry,
  appendOp,
  createCr,
  crAction,
  getTrackerPayload,
  getTrackerVersion,
  updateMember,
  updateTeam,
} from '../../../src/server/tracker';
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
});
