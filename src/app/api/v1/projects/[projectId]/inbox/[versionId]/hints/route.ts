import { getApp } from '../../../../../../../../server/app';
import { getInboxHints, type GetInboxHintsInput } from '../../../../../../../../server/domain/inbox';
import { route } from '../../../../../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route(async (ctx, _request, params, input) => ({ projectId: params.projectId, recordVersionId: params.versionId, items: await getInboxHints(getApp().db, ctx, input as GetInboxHintsInput), requestId: ctx.requestId }));
