import { getApp } from '../../../../server/app';
import { createEmptyProject, listProjects } from '../../../../server/domain/projects';
import { withEnvelope } from '../../../../server/http/envelope';
import { domain, route } from '../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route(async (ctx) =>
  withEnvelope(ctx, { items: await listProjects(getApp().db, ctx) }),
);
export const POST = route(domain(createEmptyProject), { status: 201 });
