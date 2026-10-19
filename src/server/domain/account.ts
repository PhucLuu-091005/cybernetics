import { eq } from 'drizzle-orm';
import type { ActorContext, Creator } from '../../contracts';
import { photosOn } from '../avatars/config';
import { photoUrl } from '../avatars/store';
import { users } from '../db/schema';
import type { Db } from '../db/tx';
import { AppError } from '../errors';
import { actingMember } from '../tracker/access';
import { listProjectMembers } from '../tracker/members';
import type { Member } from '../../tracker';
import { listProjects } from './projects';

type AccountBadge = { name: string; detail?: string; color?: string; photo?: string | null };

async function signedInAccount(db: Db, userId: string): Promise<AccountBadge> {
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

export type OnScreen = {
  actAs: string | undefined;
  member: Member | null;
  seeded: boolean;
  account: AccountBadge;
};

/**
 * The person on screen in a project: in a demo copy the visitor may act as another member through
 * the act-as cookie; a cookie that the project refuses (any project that is not a demo copy, a
 * removed member, a person who may not switch) falls back to the own member. Every page and every
 * /me route resolves "me" here.
 */
export async function personOnScreen(
  db: Db,
  ctx: ActorContext,
  projectId: string,
  cookie: string | undefined,
): Promise<OnScreen> {
  const acting = (actAs: string | undefined) =>
    db.transaction((tx) => actingMember(tx, ctx, projectId, actAs), { accessMode: 'read only' });
  let actAs = cookie;
  let member: Member | null;
  try {
    try {
      member = await acting(actAs);
    } catch (error) {
      const refused =
        error instanceof AppError && (error.code === 'FORBIDDEN' || error.code === 'VALIDATION');
      if (!actAs || !refused) throw error;
      actAs = undefined;
      member = await acting(undefined);
    }
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error;
    member = null;
  }
  if (member?.id !== actAs) actAs = undefined;
  const account: AccountBadge = member
    ? {
        name: member.name,
        detail: member.roleLabel || undefined,
        color: member.color,
        photo: member.photo ?? null,
      }
    : { ...(await signedInAccount(db, ctx.userId)), detail: 'Can view' };
  // A pending invitee also has no user, but is not active, so only a story person counts as seeded.
  const seeded = !!member && member.active && member.userId === null;
  return { actAs, member, seeded, account };
}

const READER: Creator = {
  member: false,
  rights: { viewMain: true, create: false, merge: false, manage: false },
};

/**
 * The rights a new key may ask for: those of the person on screen. A key made while the visitor of
 * a demo copy acts as a seeded person (`actAs`) acts as that member; else it acts as its person's
 * own member.
 */
export async function tokenCreator(
  db: Db,
  ctx: ActorContext,
  projectId: string,
  actAs?: string,
): Promise<Creator> {
  try {
    const { members } = await listProjectMembers(db, ctx, {
      projectId,
      ...(actAs ? { actAs } : {}),
    });
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
