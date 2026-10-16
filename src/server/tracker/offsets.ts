import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ActorContext } from '../../contracts';
import { findEventAt, offsetRange, type TrackerPayload } from '../../tracker';
import { trackerCrs, trackerEventOffsets } from '../db/schema';
import { withTransaction, type Db } from '../db/tx';
import { AppError, invalidInput } from '../errors';
import { requireScope } from '../http/scopes';
import { ProjectScopeSchema, readScope } from './access';
import { buildPayload } from './read';
import { loadQueue } from './store';

const SetEventOffsetInputSchema = z.strictObject({
  ...ProjectScopeSchema,
  eventId: z.string().max(100),
  minutes: z.int(),
});

/** Any reader of the project may move icons in their own view, so Main and read-only views need no change request. */
export async function setEventOffset(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof SetEventOffsetInputSchema>,
): Promise<TrackerPayload> {
  requireScope(ctx, 'project:read');
  const parsed = SetEventOffsetInputSchema.safeParse(raw);
  if (!parsed.success) throw invalidInput('Invalid event position', parsed.error);
  const { projectId, eventId, minutes, actAs } = parsed.data;
  return withTransaction(db, async (tx) => {
    const scope = await readScope(tx, ctx, projectId, actAs);
    const crs = await tx
      .select({ ops: trackerCrs.ops })
      .from(trackerCrs)
      .where(eq(trackerCrs.projectId, scope.project.id));
    const at = findEventAt(
      eventId,
      scope.tracker.base,
      await loadQueue(tx, scope.project.id),
      crs.map((cr) => cr.ops),
    );
    if (!at) throw new AppError('NOT_FOUND', 'Event not found');
    const { min, max } = offsetRange(at, scope.tracker.timeZone);
    if (minutes < min || minutes > max) {
      const message = `Give a whole number of minutes from ${min} to ${max}, so the event stays inside its day`;
      throw new AppError('VALIDATION', message, { errors: [{ path: 'minutes', message }] });
    }
    const key = and(
      eq(trackerEventOffsets.projectId, scope.project.id),
      eq(trackerEventOffsets.userId, scope.userId),
      eq(trackerEventOffsets.eventId, eventId),
    );
    if (minutes === 0) await tx.delete(trackerEventOffsets).where(key);
    else
      await tx
        .insert(trackerEventOffsets)
        .values({ ...scope.tenant, userId: scope.userId, eventId, offsetMinutes: minutes })
        .onConflictDoUpdate({
          target: [
            trackerEventOffsets.projectId,
            trackerEventOffsets.userId,
            trackerEventOffsets.eventId,
          ],
          set: { offsetMinutes: minutes, updatedAt: sql`now()` },
        });
    return buildPayload(tx, scope);
  });
}
