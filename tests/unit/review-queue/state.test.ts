import { describe, expect, it } from 'vitest';
import {
  changeSetState,
  MY_REVIEW_TITLE,
  parseReviewQuery,
  pickMyReview,
  reviewHref,
} from '../../../src/components/review-queue/state';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const P = '00000000-0000-4000-8000-0000000000aa';
const current = { mainCommitId: A, evidenceRevision: 7 };

describe('change set state', () => {
  it('is ready on the current version and evidence', () => {
    expect(changeSetState({ baseCommitId: A, evidenceRevision: 7 }, current, 0)).toBe('ready');
  });
  it('needs a refresh when only the evidence moved', () => {
    expect(changeSetState({ baseCommitId: A, evidenceRevision: 6 }, current, null)).toBe(
      'needs-refresh',
    );
  });
  it('needs an update when the graph moved with no conflict', () => {
    expect(changeSetState({ baseCommitId: B, evidenceRevision: 7 }, current, 0)).toBe(
      'needs-update',
    );
    expect(changeSetState({ baseCommitId: B, evidenceRevision: 7 }, current, null)).toBe(
      'needs-update',
    );
  });
  it('is a conflict when the graph moved and an entity changed on both sides', () => {
    expect(changeSetState({ baseCommitId: B, evidenceRevision: 7 }, current, 2)).toBe('conflict');
  });
  it('stale base wins over moved evidence', () => {
    expect(changeSetState({ baseCommitId: B, evidenceRevision: 6 }, current, 0)).toBe(
      'needs-update',
    );
  });
});

describe('my review', () => {
  const draft = (
    over: Partial<{ title: string; status: string; updatedAt: string; userId: string }>,
  ) => ({
    title: over.title ?? MY_REVIEW_TITLE,
    status: over.status ?? 'draft',
    updatedAt: over.updatedAt ?? '2026-10-09T10:00:00.000Z',
    author: { kind: 'user' as const, userId: over.userId ?? 'u1' },
  });
  it('picks the newest open "My review" of this user only', () => {
    const older = draft({ updatedAt: '2026-10-08T10:00:00.000Z' });
    const newer = draft({ updatedAt: '2026-10-09T10:00:00.000Z' });
    const other = draft({ userId: 'u2', updatedAt: '2026-10-10T10:00:00.000Z' });
    const renamed = draft({ title: 'Inbox review', updatedAt: '2026-10-11T10:00:00.000Z' });
    const merged = draft({ status: 'merged', updatedAt: '2026-10-12T10:00:00.000Z' });
    expect(pickMyReview([older, other, newer, renamed, merged], 'u1')).toBe(newer);
    expect(pickMyReview([other], 'u1')).toBeNull();
  });
  it('ignores agent drafts', () => {
    const agent = { ...draft({}), author: { kind: 'agent' as const, tokenId: 't1' } };
    expect(pickMyReview([agent as never], 'u1')).toBeNull();
  });
});

describe('review URLs', () => {
  it('defaults to change sets when one exists, else to records', () => {
    expect(parseReviewQuery({}, true)).toEqual({ tab: 'sets', item: null, r: null });
    expect(parseReviewQuery({}, false)).toEqual({ tab: 'records', item: null, r: null });
  });
  it('keeps a valid tab and ids and drops invalid ones', () => {
    expect(parseReviewQuery({ tab: 'records', r: P }, true)).toEqual({
      tab: 'records',
      item: null,
      r: P,
    });
    expect(parseReviewQuery({ tab: 'sets', item: 'nope' }, true)).toEqual({
      tab: 'sets',
      item: null,
      r: null,
    });
    expect(parseReviewQuery({ tab: ['sets', 'records'] }, false)).toEqual({
      tab: 'records',
      item: null,
      r: null,
    });
  });
  it('builds links', () => {
    expect(reviewHref(A, { tab: 'sets' })).toBe(`/projects/${A}/review?tab=sets`);
    expect(reviewHref(A, { tab: 'sets', item: P })).toBe(
      `/projects/${A}/review?tab=sets&item=${P}`,
    );
    expect(reviewHref(A, { tab: 'records', r: P })).toBe(
      `/projects/${A}/review?tab=records&r=${P}`,
    );
  });
});
