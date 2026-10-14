import type { InboxState, SourceKind } from '../../contracts/records';

export const INBOX_STATES: readonly InboxState[] = [
  'pending',
  'included',
  'ignored',
  'superseded',
  'withdrawn',
];
export const STATE_LABEL: Record<InboxState, string> = {
  pending: 'Pending',
  included: 'Included',
  ignored: 'Ignored',
  superseded: 'Superseded',
  withdrawn: 'Withdrawn',
};
export const STATE_TONE: Record<InboxState, string> = {
  pending: 'var(--caution)',
  included: 'var(--proceed)',
  ignored: 'var(--isolated)',
  superseded: 'var(--isolated)',
  withdrawn: 'var(--danger)',
};
export const SOURCE_LABEL: Record<SourceKind, string> = {
  paste: 'Paste',
  agent: 'Imported by agent',
  slack: 'Slack',
  gmail: 'Gmail',
};

export type InboxQuery = {
  state: InboxState;
  proposal: string | null;
  r?: string | null;
  cursor?: string | null;
};
/** The URL holds the tab, the selected record and the selected draft, so a link reproduces the view. */
export function inboxHref(projectId: string, query: InboxQuery): string {
  const search = new URLSearchParams({ state: query.state });
  if (query.proposal) search.set('proposal', query.proposal);
  if (query.r) search.set('r', query.r);
  if (query.cursor) search.set('cursor', query.cursor);
  return `/projects/${projectId}/inbox?${search.toString()}`;
}
