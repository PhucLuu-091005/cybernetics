import { z } from 'zod';
import type { ActorContext } from '../../contracts';
import { queueFromRows, type TrackerPayload } from '../../tracker';
import { toIso, type Db } from '../db/tx';
import { invalidInput } from '../errors';
import { ProjectScopeSchema, readScope, type Scope } from './access';
import { loadCommits, loadCrs, loadQueue, type Reader } from './store';

const GetTrackerInputSchema = z.strictObject(ProjectScopeSchema);

export async function buildPayload(db: Reader, scope: Scope): Promise<TrackerPayload> {
  const { project, tracker, members, me } = scope;
  const queue = await loadQueue(db, project.id);
  const commits = await loadCommits(db, project.id);
  const crs = await loadCrs(db, project.id, members);
  return {
    project: {
      id: project.id,
      title: project.title,
      clientName: project.clientName,
      timeZone: tracker.timeZone,
      windowStart: tracker.windowStart,
      asOf: tracker.asOf === null ? null : toIso(tracker.asOf),
      demo: tracker.demo,
      ownerMemberId: tracker.ownerMemberId,
    },
    members,
    me,
    base: tracker.base,
    queue: queueFromRows(queue),
    commits,
    crs,
  };
}

export async function getTrackerPayload(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof GetTrackerInputSchema>,
): Promise<TrackerPayload> {
  const parsed = GetTrackerInputSchema.safeParse(raw);
  if (!parsed.success) throw invalidInput('Invalid tracker read', parsed.error);
  const { projectId, actAs } = parsed.data;
  // One snapshot, so a merge that commits mid-read cannot show a merged CR without its commit.
  return db.transaction(
    async (tx) => buildPayload(tx, await readScope(tx, ctx, projectId, actAs)),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
