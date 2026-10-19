import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  actAs,
  addToQueue,
  appendOp,
  createCr,
  crAction,
  dismissQueueEntry,
  errorText,
  getTracker,
  removeOp,
  type CrAction,
} from '../../../src/components/tracker/api';

const PROJECT = '7c0e6a52-3f0b-4c1e-9a43-2a4b8d1f0c11';
const BASE = `/api/v1/projects/${PROJECT}/tracker`;
const PAYLOAD = { project: { id: PROJECT }, crs: [] };

type Call = { url: string; init: RequestInit };
let calls: Call[];
let reply: () => Promise<Response>;

beforeEach(() => {
  calls = [];
  reply = async () => Response.json(PAYLOAD);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return reply();
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const last = () => calls[calls.length - 1];
const bodyOf = (call: Call) => JSON.parse(String(call.init.body));

describe('tracker api request shapes', () => {
  it('reads the payload with GET and no body, bypassing the HTTP cache', async () => {
    const result = await getTracker(PROJECT);
    expect(result).toEqual({ ok: true, data: PAYLOAD });
    expect(last().url).toBe(BASE);
    expect(last().init.method).toBe('GET');
    expect(last().init.body).toBeUndefined();
    expect(last().init.cache).toBe('no-store');
    expect(new Headers(last().init.headers).get('accept')).toBe('application/json');
  });

  it('acts as a member with POST /act-as', async () => {
    await actAs(PROJECT, 'm-lan');
    expect(last().url).toBe(`${BASE}/act-as`);
    expect(last().init.method).toBe('POST');
    expect(new Headers(last().init.headers).get('content-type')).toBe('application/json');
    expect(bodyOf(last())).toEqual({ memberId: 'm-lan' });
  });

  it('adds an event and a work item to the queue', async () => {
    await addToQueue(PROJECT, {
      kind: 'event',
      fields: { kind: 'message', at: '2026-10-09T17:00:00+07:00', by: 'lan', text: 'Hi' },
    });
    expect(last().url).toBe(`${BASE}/queue`);
    expect(last().init.method).toBe('POST');
    expect(bodyOf(last())).toEqual({
      kind: 'event',
      fields: { kind: 'message', at: '2026-10-09T17:00:00+07:00', by: 'lan', text: 'Hi' },
    });
    await addToQueue(PROJECT, {
      kind: 'item',
      fields: {
        title: 'PG-205',
        note: '',
        doneBy: 'quang',
        requestedBy: 'lan',
        milestoneId: null,
        after: null,
        plannedFinish: '2026-10-20',
      },
    });
    expect(bodyOf(last()).kind).toBe('item');
    expect(bodyOf(last()).fields.title).toBe('PG-205');
  });

  it('dismisses a queue entry with DELETE and an empty JSON body', async () => {
    await dismissQueueEntry(PROJECT, 'q/1');
    expect(last().url).toBe(`${BASE}/queue/q%2F1`);
    expect(last().init.method).toBe('DELETE');
    expect(bodyOf(last())).toEqual({});
  });

  it('creates a change request with a title and optional ops', async () => {
    reply = async () => Response.json({ ...PAYLOAD, num: 5 });
    const result = await createCr(PROJECT, { title: 'Root cause report' });
    expect(result.ok && result.data.num).toBe(5);
    expect(last().url).toBe(`${BASE}/crs`);
    expect(bodyOf(last())).toEqual({ title: 'Root cause report' });
    await createCr(PROJECT, {
      title: 'With a change',
      ops: [{ op: 'attach', a: { eventId: 'qe1', workItemId: 'incident' } }],
    });
    expect(bodyOf(last())).toEqual({
      title: 'With a change',
      ops: [{ op: 'attach', a: { eventId: 'qe1', workItemId: 'incident' } }],
    });
  });

  it('appends an op with the revision the editor saw', async () => {
    await appendOp(PROJECT, 4, { op: 'hide', a: { eventId: 'p32' } }, 7);
    expect(last().url).toBe(`${BASE}/crs/4/ops`);
    expect(last().init.method).toBe('POST');
    expect(bodyOf(last())).toEqual({
      op: { op: 'hide', a: { eventId: 'p32' } },
      expectedRevision: 7,
    });
  });

  it('removes one op by index, or the last op for undo', async () => {
    await removeOp(PROJECT, 4, 2, 8);
    expect(last().url).toBe(`${BASE}/crs/4/ops/2`);
    expect(last().init.method).toBe('DELETE');
    expect(bodyOf(last())).toEqual({ expectedRevision: 8 });
    await removeOp(PROJECT, 4, 'last', 9);
    expect(last().url).toBe(`${BASE}/crs/4/ops/last`);
  });

  it.each<[string, CrAction]>([
    ['ready', { action: 'ready', expectedRevision: 3 }],
    ['unready', { action: 'unready' }],
    ['ask', { action: 'ask' }],
    ['cancel-ask', { action: 'cancel-ask' }],
    ['handover', { action: 'handover', to: 'm-khoa', expectedRevision: 3 }],
    ['decline', { action: 'decline', who: 'm-khoa' }],
    ['share', { action: 'share', memberId: 'm-khoa', permission: 'edit' }],
    ['share remove', { action: 'share', memberId: 'm-khoa', permission: 'remove' }],
    ['comment', { action: 'comment', body: 'Looks good', opIndex: 1 }],
    ['merge', { action: 'merge', picks: { 'loop:pg203:title': 'cr' }, expectedRevision: 4 }],
    ['request-changes', { action: 'request-changes', note: 'Add the date.', expectedRevision: 4 }],
    ['close', { action: 'close', reason: 'Main has it already.', expectedRevision: 4 }],
  ])('sends the %s action to POST /crs/[num]/actions', async (_label, action) => {
    await crAction(PROJECT, 3, action);
    expect(last().url).toBe(`${BASE}/crs/3/actions`);
    expect(last().init.method).toBe('POST');
    expect(bodyOf(last())).toEqual(action);
  });

  it('types the owner decisions so that they always carry the revision', () => {
    // @ts-expect-error merge without expectedRevision
    const merge: CrAction = { action: 'merge', picks: {} };
    // @ts-expect-error close without expectedRevision
    const close: CrAction = { action: 'close', reason: 'Not needed.' };
    // @ts-expect-error close without a reason
    const silent: CrAction = { action: 'close', expectedRevision: 4 };
    // @ts-expect-error request-changes without expectedRevision
    const back: CrAction = { action: 'request-changes', note: 'Add the date.' };
    expect([merge, close, silent, back]).toHaveLength(4);
  });
});

describe('tracker api errors', () => {
  it('maps an error envelope to code and message', async () => {
    reply = async () =>
      Response.json({ code: 'CONFLICT', message: 'Stale revision' }, { status: 409 });
    const result = await appendOp(PROJECT, 2, { op: 'hide', a: { eventId: 'p32' } }, 1);
    expect(result).toEqual({
      ok: false,
      error: { status: 409, code: 'CONFLICT', message: 'Stale revision' },
    });
  });

  it('fills in a code when the body is not JSON', async () => {
    reply = async () => new Response('<html>', { status: 404 });
    const result = await getTracker(PROJECT);
    expect(result).toEqual({
      ok: false,
      error: { status: 404, code: 'NOT_FOUND', message: 'Request failed with status 404' },
    });
  });

  it.each([
    ['an empty body', () => new Response(null, { status: 200 })],
    ['a body that is not JSON', () => new Response('<html>', { status: 200 })],
    ['a JSON value that is not an object', () => Response.json([1, 2])],
  ])('turns a 2xx with %s into an error result', async (_label, make) => {
    reply = async () => make();
    const result = await getTracker(PROJECT);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({ status: 200, code: 'INTERNAL' });
  });

  it('reports a network failure without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const result = await actAs(PROJECT, 'm-lan');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('NETWORK');
  });
});

describe('errorText', () => {
  const validation = (errors: Array<{ path: string; message: string }>) => ({
    status: 400,
    code: 'VALIDATION',
    message: 'Invalid change request',
    errors,
  });

  it('names the field of a validation error in the words of its input', () => {
    expect(errorText(validation([{ path: 'title', message: 'at most 200 characters' }]))).toBe(
      'Name: at most 200 characters',
    );
    expect(errorText(validation([{ path: 'a.ev.text', message: 'at most 4000 characters' }]))).toBe(
      'What happened: at most 4000 characters',
    );
    expect(errorText(validation([{ path: 'a.why', message: 'Must not be empty' }]))).toBe(
      'Why: Must not be empty',
    );
  });

  it('keeps the message of other errors and of fields it does not know', () => {
    expect(errorText(validation([{ path: 'expectedRevision', message: 'Too small' }]))).toBe(
      'Invalid change request',
    );
    expect(errorText(validation([]))).toBe('Invalid change request');
    expect(errorText({ status: 409, code: 'CONFLICT', message: 'Main moved.' })).toBe(
      'Main moved.',
    );
  });
});
