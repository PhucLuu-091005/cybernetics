import { z } from 'zod';
import { IdSchema, type ActorContext } from '../../contracts';
import { getApp } from '../app';
import type { Db } from '../db/tx';
import { readAuthEnvironment } from '../env';
import { AppError, invalidInput, privateJson } from '../errors';
import { personOnScreen } from '../domain/account';
import { getTrackerPayload } from '../tracker/read';
import type { Handler, Input } from './route';
import { cookieValue } from './session';

export const ACT_AS_MAX_AGE = 30 * 86_400;

export const actAsCookieName = (projectId: string) => `pg_act_${projectId}`;

export function actAsCookie(projectId: string, memberId: string): string {
  const secure = readAuthEnvironment().appOrigin.startsWith('https:') ? '; Secure' : '';
  return `${actAsCookieName(projectId)}=${memberId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ACT_AS_MAX_AGE}${secure}`;
}

export function readActAs(request: Request, projectId: string): string | undefined {
  return cookieValue(request, actAsCookieName(projectId)) ?? undefined;
}

/** Only the act-as route sets the cookie, after the use case accepts the member, so a body or query value must not pick one. */
export function asMember<I, R>(
  fn: (db: Db, ctx: ActorContext, input: I) => Promise<R>,
  map: (input: Input) => Input = (input) => input,
): Handler {
  return async (ctx, request, params, input) => {
    if (input.actAs !== undefined)
      throw new AppError('VALIDATION', 'The acting member comes from the act-as cookie', {
        errors: [{ path: 'actAs', message: 'Use POST /tracker/act-as' }],
      });
    const cookie = readActAs(request, params.projectId);
    const actAs = cookie
      ? (await personOnScreen(getApp().db, ctx, params.projectId, cookie)).actAs
      : undefined;
    return fn(getApp().db, ctx, { ...map(input), actAs } as I);
  };
}

const ActAsInputSchema = z.strictObject({
  projectId: IdSchema,
  memberId: z.string().min(1).max(200),
});

export const setActingMember: Handler = async (ctx, _request, _params, input) => {
  const parsed = ActAsInputSchema.safeParse(input);
  if (!parsed.success) throw invalidInput('Invalid act-as request', parsed.error);
  const { projectId, memberId } = parsed.data;
  const payload = await getTrackerPayload(getApp().db, ctx, { projectId, actAs: memberId });
  // The read ignores the cookie for a person without a member, so a mismatch means it was not accepted.
  if (payload.me?.id !== memberId)
    throw new AppError('FORBIDDEN', 'You can read this project, but you are not a member of it');
  const response = privateJson(payload);
  response.headers.append('Set-Cookie', actAsCookie(projectId, memberId));
  return response;
};
