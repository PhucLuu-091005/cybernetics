import { randomUUID } from 'node:crypto';
import type { ActorContext } from '../../src/contracts';
import { workspaceMembers } from '../../src/server/db/schema';
import { withTransaction, type Db } from '../../src/server/db/tx';
import { createProject } from '../../src/server/domain/projects';
import { seedTrackerDemo } from '../../src/server/tracker';
import { testActor } from './db';

export type Demo = {
  owner: ActorContext;
  projectId: string;
  workspaceId: string;
  /** Story key (minh, lan, qe1, q1...) to stored id. */
  ids: Record<string, string>;
};

export async function seedDemo(db: Db, owner?: ActorContext): Promise<Demo> {
  const ctx = owner ?? (await testActor(db, { name: 'Sandbox User' }));
  const project = await createProject(db, ctx, {
    title: 'Larkspur Capital, Fund III onboarding',
    clientName: 'Larkspur Capital',
  });
  const { ids } = await withTransaction(db, (tx) =>
    seedTrackerDemo(tx, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      userId: ctx.userId,
      userName: 'Sandbox User',
    }),
  );
  return { owner: ctx, projectId: project.id, workspaceId: project.workspaceId, ids };
}

/** A second user in the owner's workspace: they can open the project but have no tracker member. */
export async function workspaceGuest(db: Db, owner: ActorContext): Promise<ActorContext> {
  const guest = await testActor(db, { name: 'Guest' });
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: owner.workspaceId, userId: guest.userId });
  return { ...guest, workspaceId: owner.workspaceId, requestId: randomUUID() };
}
