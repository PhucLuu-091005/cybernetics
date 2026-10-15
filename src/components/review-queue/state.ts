import type { ActorReference } from '../../contracts';
import { IdSchema } from '../../contracts/primitives';

export type ChangeSetState = 'ready' | 'needs-refresh' | 'needs-update' | 'conflict';

/** A stale base comes first: the rebase also pins the current evidence, so a refresh alone would not unblock the approve. */
export function changeSetState(
  set: { baseCommitId: string; evidenceRevision: number },
  current: { mainCommitId: string; evidenceRevision: number },
  conflictCount: number | null,
): ChangeSetState {
  if (set.baseCommitId !== current.mainCommitId) return conflictCount ? 'conflict' : 'needs-update';
  return set.evidenceRevision === current.evidenceRevision ? 'ready' : 'needs-refresh';
}

export const STATE_BADGE: Record<ChangeSetState, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  ready: { label: 'Ready', tone: 'ok' },
  'needs-refresh': { label: 'Needs refresh', tone: 'warn' },
  'needs-update': { label: 'Needs update', tone: 'warn' },
  conflict: { label: 'Conflict', tone: 'bad' },
};

export const MY_REVIEW_TITLE = 'My review';

export function pickMyReview<
  T extends { title: string; status: string; updatedAt: string; author: ActorReference },
>(drafts: readonly T[], userId: string): T | null {
  const mine = drafts.filter(
    (draft) =>
      draft.status === 'draft' &&
      draft.title === MY_REVIEW_TITLE &&
      draft.author.kind === 'user' &&
      draft.author.userId === userId,
  );
  mine.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return mine[0] ?? null;
}

export type ReviewQuery = { tab: 'sets' | 'records'; item: string | null; r: string | null };

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : null);
const id = (value: string | null) =>
  value !== null && IdSchema.safeParse(value).success ? value : null;

export function parseReviewQuery(
  raw: Record<string, string | string[] | undefined>,
  hasSets: boolean,
): ReviewQuery {
  const tab = one(raw.tab);
  return {
    tab: tab === 'sets' || tab === 'records' ? tab : hasSets ? 'sets' : 'records',
    item: id(one(raw.item)),
    r: id(one(raw.r)),
  };
}

export function reviewHref(
  projectId: string,
  query: Partial<ReviewQuery> & { tab: ReviewQuery['tab'] },
): string {
  const search = new URLSearchParams({ tab: query.tab });
  if (query.item) search.set('item', query.item);
  if (query.r) search.set('r', query.r);
  return `/projects/${projectId}/review?${search.toString()}`;
}
