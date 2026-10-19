import type {
  CrPermission,
  OpName,
  OpOf,
  Picks,
  QueueEventInput,
  QueueItemInput,
  TrackerPayload,
  TrackerVersion,
} from '../../tracker';

export type ApiError = {
  status: number;
  code: string;
  message: string;
  errors?: Array<{ path: string; message: string }>;
};
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** The server sets `rev`, `by` and `d`; the browser sends the operation and its arguments. */
export type OpInput = { [N in OpName]: { op: N; a: OpOf<N>['a'] } }[OpName];

export type QueueEntry =
  { kind: 'event'; fields: QueueEventInput } | { kind: 'item'; fields: QueueItemInput };

/** A decision acts on what the person saw, so merge, close and request-changes carry the CR revision. */
type Seen = { expectedRevision?: number };
type Reviewed = { expectedRevision: number };
export type CrAction =
  | (Seen & { action: 'ready' | 'unready' | 'ask' | 'cancel-ask' })
  | (Seen & { action: 'handover'; to: string })
  | (Seen & { action: 'decline'; who: string })
  | (Seen & { action: 'share'; memberId: string; permission: CrPermission | 'remove' })
  | (Seen & { action: 'comment'; body: string; opIndex?: number | null })
  | (Reviewed & { action: 'merge'; picks: Picks })
  | (Reviewed & { action: 'request-changes'; note: string })
  | (Reviewed & { action: 'close'; reason: string });

const CODE_BY_STATUS: Record<number, string> = {
  400: 'VALIDATION',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
};

async function send<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(
      path,
      method === 'GET'
        ? { method, headers: { Accept: 'application/json' }, cache: 'no-store' }
        : {
            method,
            headers: { Accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify(body ?? {}),
          },
    );
  } catch {
    return {
      ok: false,
      error: {
        status: 0,
        code: 'NETWORK',
        message: 'The request did not reach the server. Try again.',
      },
    };
  }
  const data: unknown = await response.json().catch(() => null);
  const isObject = !!data && typeof data === 'object' && !Array.isArray(data);
  if (response.ok && isObject) return { ok: true, data: data as T };
  if (response.ok)
    return {
      ok: false,
      error: {
        status: response.status,
        code: 'INTERNAL',
        message: 'The server answered without the tracker data. Reload the page.',
      },
    };
  const error = isObject ? (data as Partial<ApiError>) : {};
  return {
    ok: false,
    error: {
      status: response.status,
      code: error.code ?? CODE_BY_STATUS[response.status] ?? 'INTERNAL',
      message: error.message ?? `Request failed with status ${response.status}`,
      ...(error.errors ? { errors: error.errors } : {}),
    },
  };
}

const tracker = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/tracker`;
const cr = (projectId: string, num: number) => `${tracker(projectId)}/crs/${num}`;

export const getTracker = (projectId: string) => send<TrackerPayload>(tracker(projectId), 'GET');

export const getTrackerVersion = (projectId: string, num: number | null = null) =>
  send<TrackerVersion>(`${tracker(projectId)}/version${num === null ? '' : `?num=${num}`}`, 'GET');

export const actAs = (projectId: string, memberId: string) =>
  send<TrackerPayload>(`${tracker(projectId)}/act-as`, 'POST', { memberId });

export const addToQueue = (projectId: string, entry: QueueEntry) =>
  send<TrackerPayload>(`${tracker(projectId)}/queue`, 'POST', entry);

export const dismissQueueEntry = (projectId: string, queueId: string) =>
  send<TrackerPayload>(`${tracker(projectId)}/queue/${encodeURIComponent(queueId)}`, 'DELETE');

export const createCr = (projectId: string, input: { title: string; ops?: OpInput[] }) =>
  send<TrackerPayload & { num: number }>(`${tracker(projectId)}/crs`, 'POST', input);

export const appendOp = (projectId: string, num: number, op: OpInput, expectedRevision: number) =>
  send<TrackerPayload>(`${cr(projectId, num)}/ops`, 'POST', { op, expectedRevision });

export const removeOp = (
  projectId: string,
  num: number,
  index: number | 'last',
  expectedRevision: number,
) => send<TrackerPayload>(`${cr(projectId, num)}/ops/${index}`, 'DELETE', { expectedRevision });

export const crAction = (projectId: string, num: number, action: CrAction) =>
  send<TrackerPayload>(`${cr(projectId, num)}/actions`, 'POST', action);
