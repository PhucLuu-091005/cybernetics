import { randomUUID } from 'node:crypto';
import type { ActorContext } from '../../src/contracts';
import { workspaceMembers } from '../../src/server/db/schema';
import { withTransaction, type Db } from '../../src/server/db/tx';
import { seedTrackerDemo } from '../../src/server/tracker';
import { LARKSPUR_STORY_NOW, larkspurHistory } from '../../src/server/tracker/seed/larkspur';
import { testActor } from './db';

export type Demo = {
  owner: ActorContext;
  projectId: string;
  workspaceId: string;
  /** Story key (minh, lan, qe1, q1...) to stored id. */
  ids: Record<string, string>;
};

/** The story with its clock pinned at the story's own now, so the tests read fixed dates and statuses. */
export async function seedDemo(db: Db, owner?: ActorContext): Promise<Demo> {
  const ctx = owner ?? (await testActor(db, { name: 'Sandbox User' }));
  const { projectId, ids } = await withTransaction(db, (tx) =>
    seedTrackerDemo(tx, {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      now: new Date(LARKSPUR_STORY_NOW),
      asOf: LARKSPUR_STORY_NOW,
    }),
  );
  return { owner: ctx, projectId, workspaceId: ctx.workspaceId, ids };
}

/** A second user in the owner's workspace: they can open the project but have no tracker member. */
export async function workspaceGuest(db: Db, owner: ActorContext): Promise<ActorContext> {
  const guest = await testActor(db, { name: 'Guest' });
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: owner.workspaceId, userId: guest.userId });
  return { ...guest, workspaceId: owner.workspaceId, requestId: randomUUID() };
}

/** The merged history change requests take the low numbers; the story's own ones follow. */
export const HISTORY = larkspurHistory().crs.length;
/** The stored number of the story's change request #n (1 is "Explain the go-live slip"). */
export const storyCr = (n: number) => HISTORY + n;
