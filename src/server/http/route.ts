import type { ActorContext } from '../../contracts';
import { browserActor, getApp } from '../app';
import type { Db } from '../db/tx';
import { AppError, errorResponse, newRequestId, privateJson } from '../errors';

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export type Input = Record<string, unknown>;
type Params = Record<string, string>;
export type Handler = (
  ctx: ActorContext,
  request: Request,
  params: Params,
  input: Input,
) => Promise<unknown>;
// Route segments use short names; domain inputs use the contract field names.
const FIELD: Record<string, string> = { versionId: 'recordVersionId' };
// Query strings carry only text, so contract numbers and arrays are restored here and Zod still validates them.
const NUMBERS = new Set([
  'limit',
  'proposalRevision',
  'expectedProposalRevision',
  'expectedEvidenceRevision',
]);
const ARRAYS = new Set(['states', 'departmentIds']);
const invalid = (path: string, message: string) =>
  new AppError('VALIDATION', message, { errors: [{ path, message }] });

async function readBody(request: Request): Promise<Input> {
  const tooLarge = () => new AppError('LIMIT_EXCEEDED', 'Request body exceeds 2 MiB');
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) throw tooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      size += next.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(next.value);
    }
  }
  // A DELETE names its target in the path, so fetch callers may send no body at all.
  if (size === 0 && request.method === 'DELETE') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw invalid('body', 'Request body must be UTF-8 JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw invalid('body', 'Request body must be a JSON object');
  return parsed as Input;
}
function readQuery(request: Request): Input {
  const input: Input = {},
    query = new URL(request.url).searchParams;
  for (const key of new Set(query.keys())) {
    const values = query.getAll(key);
    if (ARRAYS.has(key)) input[key] = values;
    else if (values.length > 1) throw invalid(key, 'Repeat only list parameters');
    else
      input[key] = NUMBERS.has(key) && /^\d{1,15}$/.test(values[0]) ? Number(values[0]) : values[0];
  }
  return input;
}

/** Route IDs override nothing silently: the session and URL scope are authoritative, so a different body value is VALIDATION. */
export function route(handler: Handler, opts: { status?: number } = {}) {
  return async (request: Request, context: { params: Promise<Params> }): Promise<Response> => {
    let ctx: ActorContext | undefined;
    try {
      ctx = await browserActor(request);
      // Next passes no params to a static route such as /api/v1/projects, whatever the type says.
      const params = (await context.params) ?? {};
      const input =
        request.method === 'GET' || request.method === 'HEAD'
          ? readQuery(request)
          : await readBody(request);
      for (const [name, value] of Object.entries(params)) {
        const field = FIELD[name] ?? name;
        if (input[field] !== undefined && input[field] !== value)
          throw invalid(field, `${field} must match the route`);
        input[field] = value;
      }
      const result = await handler(ctx, request, params, input);
      return result instanceof Response ? result : privateJson(result, opts.status);
    } catch (error) {
      return errorResponse(error, ctx?.requestId ?? newRequestId());
    }
  };
}

// The cast is safe because every domain entry point re-validates its input with Zod.
export function domain<I, R>(
  fn: (db: Db, ctx: ActorContext, input: I) => Promise<R>,
  map: (input: Input) => Input = (input) => input,
): Handler {
  return (ctx, _request, _params, input) => fn(getApp().db, ctx, map(input) as I);
}

/** Mirrors the inbox query shape so every browser read selects a view the same way. */
export function withView({ commitId, proposalId, proposalRevision, ...rest }: Input): Input {
  if (proposalId !== undefined) {
    if (commitId !== undefined || proposalRevision === undefined)
      throw invalid('proposalRevision', 'A proposal view needs proposalRevision and no commitId');
    return { ...rest, view: { kind: 'proposal', proposalId, proposalRevision } };
  }
  if (proposalRevision !== undefined)
    throw invalid('proposalId', 'proposalRevision needs proposalId');
  return {
    ...rest,
    view: commitId !== undefined ? { kind: 'commit', commitId } : { kind: 'main' },
  };
}

/** SRD 11 lists browser imports as paste; other source kinds arrive through MCP or connectors. */
export function pasteImport(input: Input): Input {
  if ((input.source ?? 'paste') !== 'paste')
    throw invalid('source', 'Browser imports must use source paste');
  return { ...input, source: 'paste' };
}
