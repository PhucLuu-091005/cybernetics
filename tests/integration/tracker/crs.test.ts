import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../../src/server/domain/projects';
import {
  appendOp,
  createCr,
  crAction,
  getTrackerPayload,
  removeOp,
} from '../../../src/server/tracker';
import { clashesOf, mainState, type TrackerPayload } from '../../../src/tracker';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { seedDemo, type Demo } from '../../support/tracker-db';

const crOf = (payload: TrackerPayload, num: number) => {
  const cr = payload.crs.find((item) => item.num === num);
  if (!cr) throw new Error(`No CR #${num}`);
  return cr;
};
const lastComment = (payload: TrackerPayload, num: number) => crOf(payload, num).comments.at(-1);
const PG203 = 'loop:pg203:title';

describe.skipIf(!process.env.TEST_DATABASE_URL)('tracker change requests', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.close();
  });
  let demo: Demo;
  const as = (key: string) => ({ projectId: demo.projectId, actAs: demo.ids[key] });
  const action = (key: string, num: number, body: Record<string, unknown>) =>
    crAction(t.db, demo.owner, { ...as(key), num, ...body } as Parameters<typeof crAction>[2]);
  const fresh = async () => {
    demo = await seedDemo(t.db);
  };

  describe('create', () => {
    it('numbers change requests per project and starts a draft that its author edits', async () => {
      await fresh();
      const five = await createCr(t.db, demo.owner, { ...as('lan'), title: 'Root cause report' });
      expect(five.num).toBe(5);
      const cr = crOf(five.payload, 5);
      expect(cr).toMatchObject({
        title: 'Root cause report',
        author: demo.ids.lan,
        editor: demo.ids.lan,
        status: 'draft',
        ops: [],
        revision: 0,
        shares: [],
        asks: [],
        mergedRev: null,
        closedRev: null,
        resolutions: [],
      });
      expect(cr.comments).toEqual([
        {
          id: expect.any(String),
          memberId: demo.ids.lan,
          kind: 'created',
          body: null,
          opIndex: null,
          createdAt: expect.any(String),
        },
      ]);
      expect((await createCr(t.db, demo.owner, { ...as('minh'), title: 'Next' })).num).toBe(6);
      const ctx = await testActor(t.db);
      const other = await createEmptyProject(t.db, ctx, {
        title: 'Other',
        clientName: 'O',
        teams: ['QA'],
      });
      expect((await createCr(t.db, ctx, { projectId: other.id, title: 'First' })).num).toBe(1);
    });

    it('stores the pending ops of a new change request with the Main revision and the author', async () => {
      await fresh();
      const { num, payload } = await createCr(t.db, demo.owner, {
        ...as('lan'),
        title: 'Investor template on go-live',
        ops: [{ op: 'qms', a: { itemId: demo.ids.q2, milestoneId: 'golive' } }],
      });
      expect(crOf(payload, num).ops).toEqual([
        {
          op: 'qms',
          a: { itemId: demo.ids.q2, milestoneId: 'golive' },
          rev: 1,
          by: demo.ids.lan,
          d: {
            item: 'Investor statement template',
            change: 'milestone set',
            before: 'No milestone',
            after: 'Go-live and first close',
          },
        },
      ]);
      await expect(
        createCr(t.db, demo.owner, {
          ...as('lan'),
          title: 'Bad',
          ops: [{ op: 'rename', a: { workItemId: 'nope', title: 'X' } }],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(createCr(t.db, demo.owner, { ...as('lan'), title: '  ' })).rejects.toMatchObject(
        { code: 'VALIDATION' },
      );
    });
  });

  describe('ops', () => {
    it('appends ops under expectedRevision and rejects a stale revision', async () => {
      await fresh();
      const { num } = await createCr(t.db, demo.owner, { ...as('lan'), title: 'Incident' });
      const first = await appendOp(t.db, demo.owner, {
        ...as('lan'),
        num,
        expectedRevision: 0,
        op: { op: 'attach', a: { eventId: demo.ids.qe1, workItemId: 'incident' } },
      });
      expect(crOf(first, num)).toMatchObject({ revision: 1 });
      expect(crOf(first, num).ops).toEqual([
        {
          op: 'attach',
          a: { eventId: demo.ids.qe1, workItemId: 'incident' },
          rev: 1,
          by: demo.ids.lan,
          d: {
            item: 'Message by Sarah Kim',
            change: 'added',
            before: 'Queue',
            after: 'Sync incident report, 9 Oct 14:20',
            icon: 'message',
          },
        },
      ]);
      await expect(
        appendOp(t.db, demo.owner, {
          ...as('lan'),
          num,
          expectedRevision: 0,
          op: { op: 'rename', a: { workItemId: 'incident', title: 'Root cause report' } },
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const second = await appendOp(t.db, demo.owner, {
        ...as('lan'),
        num,
        expectedRevision: 1,
        op: { op: 'rename', a: { workItemId: 'incident', title: 'Root cause report' } },
      });
      expect(crOf(second, num).ops.map((op) => op.op)).toEqual(['attach', 'rename']);
      expect(crOf(second, num).revision).toBe(2);
    });

    it('rejects an op that does not fit the latest Main plus the change request', async () => {
      await fresh();
      const { num } = await createCr(t.db, demo.owner, { ...as('lan'), title: 'Bad ops' });
      const append = (op: unknown) =>
        appendOp(t.db, demo.owner, { ...as('lan'), num, expectedRevision: 0, op } as never);
      await expect(
        append({ op: 'attach', a: { eventId: demo.ids.qe3, workItemId: 'test' } }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        append({ op: 'rename', a: { workItemId: 'missing', title: 'X' } }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(append({ op: 'rename', a: { workItemId: 'pg203' } })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      await expect(
        append({
          op: 'due',
          a: { workItemId: 'pg203', date: '2026-10-20', why: '   ', by: demo.ids.lan, at: 'x' },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      const payload = await getTrackerPayload(t.db, demo.owner, as('lan'));
      expect(crOf(payload, num)).toMatchObject({ ops: [], revision: 0 });
    });

    it('records the acting member as the person who moves a date', async () => {
      await fresh();
      const { num } = await createCr(t.db, demo.owner, { ...as('lan'), title: 'Dates' });
      const payload = await appendOp(t.db, demo.owner, {
        ...as('lan'),
        num,
        expectedRevision: 0,
        op: {
          op: 'due',
          a: {
            workItemId: 'pg203',
            date: '2026-10-12',
            why: 'Quang needs the list from Lan first.',
            by: demo.ids.minh,
            at: '2026-10-09T17:00:00+07:00',
          },
        },
      });
      const [op] = crOf(payload, num).ops;
      expect(op.op === 'due' && op.a.by).toBe(demo.ids.lan);
      expect(op.d).toMatchObject({ before: '6 Oct', after: '12 Oct', why: expect.any(String) });
    });

    it('undoes the last op and removes an op by index', async () => {
      await fresh();
      const { num } = await createCr(t.db, demo.owner, {
        ...as('lan'),
        title: 'Undo',
        ops: [
          { op: 'rename', a: { workItemId: 'incident', title: 'Incident A' } },
          { op: 'rename', a: { workItemId: 'secret', title: 'Secret B' } },
          { op: 'msAdd', a: { workItemId: 'test', milestoneId: 'golive' } },
        ],
      });
      const undone = await removeOp(t.db, demo.owner, {
        ...as('lan'),
        num,
        index: 'last',
        expectedRevision: 0,
      });
      expect(crOf(undone, num).ops.map((op) => op.op)).toEqual(['rename', 'rename']);
      expect(crOf(undone, num).revision).toBe(1);
      const removed = await removeOp(t.db, demo.owner, {
        ...as('lan'),
        num,
        index: '0',
        expectedRevision: 1,
      });
      expect(crOf(removed, num).ops.map((op) => op.op === 'rename' && op.a.title)).toEqual([
        'Secret B',
      ]);
      await expect(
        removeOp(t.db, demo.owner, { ...as('lan'), num, index: 4, expectedRevision: 2 }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        removeOp(t.db, demo.owner, { ...as('lan'), num, index: 'last', expectedRevision: 1 }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('ready and edit again', () => {
    it('needs at least one change, locks the ops, and unlocks with Edit again', async () => {
      await fresh();
      const { num } = await createCr(t.db, demo.owner, { ...as('lan'), title: 'Ready' });
      await expect(action('lan', num, { action: 'ready' })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      await appendOp(t.db, demo.owner, {
        ...as('lan'),
        num,
        expectedRevision: 0,
        op: { op: 'rename', a: { workItemId: 'incident', title: 'Incident report' } },
      });
      const ready = await action('lan', num, { action: 'ready' });
      expect(crOf(ready, num).status).toBe('ready');
      expect(lastComment(ready, num)).toMatchObject({ kind: 'ready', memberId: demo.ids.lan });
      await expect(
        appendOp(t.db, demo.owner, {
          ...as('lan'),
          num,
          expectedRevision: crOf(ready, num).revision,
          op: { op: 'rename', a: { workItemId: 'secret', title: 'Secret' } },
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(action('lan', num, { action: 'ready' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      const draft = await action('lan', num, { action: 'unready' });
      expect(crOf(draft, num).status).toBe('draft');
      expect(lastComment(draft, num)).toMatchObject({ kind: 'unready', memberId: demo.ids.lan });
      await expect(action('lan', num, { action: 'unready' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('editing hand-over', () => {
    it('asks to edit and cancels the ask', async () => {
      await fresh();
      const asked = await action('khoa', 4, { action: 'ask' });
      expect(crOf(asked, 4).asks).toEqual([
        { memberId: demo.ids.khoa, createdAt: expect.any(String) },
      ]);
      expect(lastComment(asked, 4)).toMatchObject({ kind: 'ask', memberId: demo.ids.khoa });
      const again = await action('khoa', 4, { action: 'ask' });
      expect(crOf(again, 4).asks).toHaveLength(1);
      expect(crOf(again, 4).comments.filter((c) => c.kind === 'ask')).toHaveLength(1);
      const cancelled = await action('khoa', 4, { action: 'cancel-ask' });
      expect(crOf(cancelled, 4).asks).toEqual([]);
    });

    it('hands over to a member with edit right, and not to anyone else', async () => {
      await fresh();
      await action('khoa', 4, { action: 'ask' });
      const handed = await action('ha', 4, { action: 'handover', to: demo.ids.khoa });
      expect(crOf(handed, 4)).toMatchObject({ editor: demo.ids.khoa, asks: [] });
      expect(lastComment(handed, 4)).toMatchObject({
        kind: 'handover',
        memberId: demo.ids.ha,
        body: 'Khoa Lê edits now.',
      });
      const appended = await appendOp(t.db, demo.owner, {
        ...as('khoa'),
        num: 4,
        expectedRevision: crOf(handed, 4).revision,
        op: { op: 'rename', a: { workItemId: 'test', title: 'Test the CRS section on staging' } },
      });
      expect(crOf(appended, 4).ops.at(-1)?.by).toBe(demo.ids.khoa);
      await expect(
        action('khoa', 4, { action: 'handover', to: demo.ids.lan }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const back = await action('khoa', 4, { action: 'handover', to: demo.ids.ha });
      expect(crOf(back, 4).editor).toBe(demo.ids.ha);
    });

    it('declines an ask with Not now', async () => {
      await fresh();
      await action('khoa', 4, { action: 'ask' });
      const declined = await action('ha', 4, { action: 'decline', who: demo.ids.khoa });
      expect(crOf(declined, 4)).toMatchObject({ editor: demo.ids.ha, asks: [] });
      expect(lastComment(declined, 4)).toMatchObject({
        kind: 'decline',
        memberId: demo.ids.ha,
        body: 'Not now, Khoa.',
      });
      await expect(
        action('ha', 4, { action: 'decline', who: demo.ids.khoa }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });

  describe('share', () => {
    it('shares with Can view or Can edit and removes a share', async () => {
      await fresh();
      const viewed = await action('ha', 4, {
        action: 'share',
        memberId: demo.ids.lan,
        permission: 'view',
      });
      expect(crOf(viewed, 4).shares).toEqual(
        expect.arrayContaining([
          { memberId: demo.ids.khoa, permission: 'edit' },
          { memberId: demo.ids.lan, permission: 'view' },
        ]),
      );
      expect(lastComment(viewed, 4)).toMatchObject({
        kind: 'shared',
        memberId: demo.ids.ha,
        body: 'Lan Phạm can view.',
      });
      await expect(action('lan', 4, { action: 'ask' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await action('ha', 4, { action: 'share', memberId: demo.ids.lan, permission: 'edit' });
      const asked = await action('lan', 4, { action: 'ask' });
      expect(crOf(asked, 4).asks.map((ask) => ask.memberId)).toEqual([demo.ids.lan]);
      const removed = await action('ha', 4, {
        action: 'share',
        memberId: demo.ids.lan,
        permission: 'remove',
      });
      expect(crOf(removed, 4).shares).toEqual([{ memberId: demo.ids.khoa, permission: 'edit' }]);
      expect(crOf(removed, 4).asks).toEqual([]);
      await expect(
        action('ha', 4, { action: 'share', memberId: demo.ids.ha, permission: 'view' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        action('ha', 4, { action: 'share', memberId: demo.ids.qe1, permission: 'view' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });

  describe('comments', () => {
    it('lets any member comment on the change request or on one change', async () => {
      await fresh();
      const general = await action('lan', 4, { action: 'comment', body: 'Use the staging list.' });
      expect(lastComment(general, 4)).toMatchObject({
        kind: 'comment',
        memberId: demo.ids.lan,
        body: 'Use the staging list.',
        opIndex: null,
      });
      const onOp = await action('quang', 4, { action: 'comment', body: 'OK', opIndex: 0 });
      expect(lastComment(onOp, 4)).toMatchObject({ opIndex: 0, memberId: demo.ids.quang });
      await expect(action('lan', 4, { action: 'comment', body: ' ' })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      await expect(
        action('lan', 4, { action: 'comment', body: 'X', opIndex: 3 }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });

  describe('merge', () => {
    it('merges a change request without a clash as commit rev N+1', async () => {
      await fresh();
      const merged = await action('minh', 2, { action: 'merge', picks: {} });
      expect(merged.commits.map((commit) => commit.rev)).toEqual([1, 2]);
      const commit = merged.commits[1];
      expect(commit).toMatchObject({
        rev: 2,
        crNum: 2,
        crId: crOf(merged, 2).id,
        mergedBy: demo.ids.minh,
        resolutions: [],
      });
      expect(commit.ops.map((op) => op.op)).toEqual(['place', 'rename']);
      expect(crOf(merged, 2)).toMatchObject({
        status: 'merged',
        mergedRev: 2,
        mergedBy: demo.ids.minh,
        mergedAt: commit.mergedAt,
      });
      expect(lastComment(merged, 2)).toMatchObject({ kind: 'merged', memberId: demo.ids.minh });
      const main = mainState(merged.base, merged.queue, merged.commits);
      expect(main.workItems.find((item) => item.id === demo.ids.q1)?.teamId).toBe('engineering');
      expect(main.workItems.find((item) => item.id === 'pg203')?.title).toBe(
        'PG-203 Country list field (multi-select)',
      );
      await expect(action('minh', 2, { action: 'merge', picks: {} })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('rejects a merge with a clash and no pick, and a pick for a spot that does not clash', async () => {
      await fresh();
      await expect(
        action('minh', 2, { action: 'merge', picks: { [PG203]: 'cr' } }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const afterTwo = await action('minh', 2, { action: 'merge', picks: {} });
      expect(clashesOf(crOf(afterTwo, 3).ops, afterTwo.commits).map((c) => c.key)).toEqual([PG203]);
      await expect(action('minh', 3, { action: 'merge', picks: {} })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      await expect(
        action('minh', 3, { action: 'merge', picks: { [PG203]: 'cr', 'ms:golive:date': 'cr' } }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        action('minh', 3, { action: 'merge', picks: { [PG203]: 'both' } }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('records the picks as resolutions and a resolved comment', async () => {
      await fresh();
      await action('minh', 2, { action: 'merge', picks: {} });
      const merged = await action('minh', 3, { action: 'merge', picks: { [PG203]: 'cr' } });
      const resolution = {
        key: PG203,
        label: 'PG-203 Country list field type · name',
        chose: 'cr',
        mainVal: 'PG-203 Country list field (multi-select)',
        crVal: 'PG-203 Country list field type, on staging',
        from: 2,
        by: demo.ids.minh,
      };
      expect(merged.commits[2]).toMatchObject({ rev: 3, crNum: 3, resolutions: [resolution] });
      expect(merged.commits[2].ops.map((op) => op.op)).toEqual(['addEvent', 'rename']);
      expect(crOf(merged, 3)).toMatchObject({
        status: 'merged',
        mergedRev: 3,
        resolutions: [resolution],
      });
      expect(crOf(merged, 3).comments.slice(-2)).toMatchObject([
        {
          kind: 'resolved',
          memberId: demo.ids.minh,
          body: 'PG-203 Country list field type · name: kept this change request, "PG-203 Country list field type, on staging".',
        },
        { kind: 'merged', memberId: demo.ids.minh },
      ]);
      const main = mainState(merged.base, merged.queue, merged.commits);
      expect(main.workItems.find((item) => item.id === 'pg203')?.title).toBe(
        'PG-203 Country list field type, on staging',
      );
    });

    it('drops the op of a clash picked as main from the commit', async () => {
      await fresh();
      await action('minh', 2, { action: 'merge', picks: {} });
      const merged = await action('minh', 3, { action: 'merge', picks: { [PG203]: 'main' } });
      expect(merged.commits[2].ops.map((op) => op.op)).toEqual(['addEvent']);
      expect(merged.commits[2].resolutions[0]).toMatchObject({ chose: 'main', from: 2 });
      expect(lastComment(merged, 3)?.kind).toBe('merged');
      expect(crOf(merged, 3).comments.at(-2)?.body).toBe(
        'PG-203 Country list field type · name: kept Main\'s version from #2, "PG-203 Country list field (multi-select)".',
      );
      const main = mainState(merged.base, merged.queue, merged.commits);
      expect(main.workItems.find((item) => item.id === 'pg203')?.title).toBe(
        'PG-203 Country list field (multi-select)',
      );
      expect(main.events.find((event) => event.id === 'qd1')?.workItemId).toBe('pg203');
    });

    it('merges only a ready change request', async () => {
      await fresh();
      await expect(action('minh', 4, { action: 'merge', picks: {} })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('request changes and close', () => {
    it('returns a ready change request to draft with a changes note', async () => {
      await fresh();
      await expect(
        action('minh', 2, { action: 'request-changes', note: '  ' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      const back = await action('minh', 2, {
        action: 'request-changes',
        note: 'Add the tax ID rules first.',
      });
      expect(crOf(back, 2)).toMatchObject({ status: 'draft', editor: demo.ids.lan });
      expect(lastComment(back, 2)).toMatchObject({
        kind: 'changes',
        memberId: demo.ids.minh,
        body: 'Add the tax ID rules first.',
      });
      await expect(
        action('minh', 2, { action: 'request-changes', note: 'Again' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('closes a ready change request without merging', async () => {
      await fresh();
      const closed = await action('minh', 3, { action: 'close' });
      expect(crOf(closed, 3)).toMatchObject({
        status: 'closed',
        closedBy: demo.ids.minh,
        closedRev: 1,
        closedAt: expect.any(String),
      });
      expect(lastComment(closed, 3)).toMatchObject({ kind: 'closed', memberId: demo.ids.minh });
      expect(closed.commits).toHaveLength(1);
      await expect(action('minh', 3, { action: 'close' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      await expect(
        action('khoa', 3, { action: 'comment', body: 'Too late' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('rejects an unknown change request and an unknown action', async () => {
    await fresh();
    await expect(action('lan', 99, { action: 'ready' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(action('lan', 2, { action: 'sync' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});
