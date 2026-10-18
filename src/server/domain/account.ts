import { eq } from 'drizzle-orm';
import type { ActorContext, Creator } from '../../contracts';
import { photosOn } from '../avatars/config';
import { photoUrl } from '../avatars/store';
import { users } from '../db/schema';
import type { Db } from '../db/tx';
import { AppError } from '../errors';
import { listProjectMembers } from '../tracker/members';
import { listProjects } from './projects';

export type AccountBadge = { name: string; detail?: string; color?: string; photo?: string | null };

export async function signedInAccount(db: Db, userId: string): Promise<AccountBadge> {
  const [row] = await db
    .select({ name: users.name, email: users.email, avatarKey: users.avatarKey })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const photo = photosOn() ? photoUrl(userId, row?.avatarKey ?? null) : null;
  return {
    name: row?.name ?? 'You',
    ...(row?.email ? { detail: row.email } : {}),
    ...(photo ? { photo } : {}),
  };
}

/** The top right of a project page names the acting member, as the graph does; a person with none sees their own name. */
export async function projectAccount(
  db: Db,
  ctx: ActorContext,
  projectId: string,
  actAs: string | undefined,
): Promise<AccountBadge> {
  for (const cookie of actAs ? [actAs, undefined] : [undefined]) {
    try {
      const { members } = await listProjectMembers(db, ctx, {
        projectId,
        ...(cookie ? { actAs: cookie } : {}),
      });
      const you = members.find((member) => member.you);
      if (you)
        return {
          name: you.name,
          detail: you.label || undefined,
          color: you.color,
          photo: you.photo,
        };
      break;
    } catch (error) {
      if (!(error instanceof AppError) || error.code === 'RATE_LIMITED') throw error;
    }
  }
  return { ...(await signedInAccount(db, ctx.userId)), detail: 'Can view' };
}

const READER: Creator = {
  member: false,
  rights: { viewMain: true, create: false, merge: false, manage: false },
};

/** A token acts as its person's own member, never as the demo person they work as now. */
export async function tokenCreator(db: Db, ctx: ActorContext, projectId: string): Promise<Creator> {
  try {
    const { members } = await listProjectMembers(db, ctx, { projectId });
    const own = members.find((member) => member.you);
    return own ? { member: true, rights: own.rights } : READER;
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return READER;
    throw error;
  }
}

/** A personal key may hold a right that its person holds in at least one project; each call checks that project. */
export async function personalCreator(db: Db, ctx: ActorContext): Promise<Creator> {
  const creators = await Promise.all(
    (await listProjects(db, ctx)).map((project) => tokenCreator(db, ctx, project.id)),
  );
  return creators.reduce<Creator>(
    (all, one) => ({
      member: all.member || one.member,
      rights: {
        viewMain: all.rights.viewMain || one.rights.viewMain,
        create: all.rights.create || one.rights.create,
        merge: all.rights.merge || one.rights.merge,
        manage: all.rights.manage || one.rights.manage,
      },
    }),
    { member: false, rights: { viewMain: false, create: false, merge: false, manage: false } },
  );
}
