import { getApp } from '../../../../server/app';
import { createProject, listProjects } from '../../../../server/domain/projects';
import { domain, route } from '../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route(async ctx => ({ items: await listProjects(getApp().db, ctx), requestId: ctx.requestId }));
export const POST = route(domain(createProject), { status: 201 });
