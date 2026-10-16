import type { Commit } from './clash';
import type { TrackerBase, TrackerQueue } from './model';
import type { Op } from './ops';
import type { QueueEventInput, QueueItemInput } from './schemas';

export type Member = {
  id: string;
  name: string;
  roleLabel: string;
  color: string;
  userId: string | null;
};

export type CrStatus = 'draft' | 'ready' | 'merged' | 'closed';

export type CrPermission = 'edit' | 'view';

export type CrCommentKind =
  | 'created'
  | 'ready'
  | 'unready'
  | 'changes'
  | 'comment'
  | 'resolved'
  | 'merged'
  | 'closed'
  | 'shared'
  | 'ask'
  | 'handover'
  | 'decline';

export type Resolution = {
  key: string;
  label: string;
  chose: 'main' | 'cr';
  mainVal: string;
  crVal: string;
  from: number;
  by: string;
};

export type Cr = {
  id: string;
  num: number;
  title: string;
  author: string;
  editor: string;
  status: CrStatus;
  ops: Op[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  mergedRev: number | null;
  mergedBy: string | null;
  mergedAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
  closedRev: number | null;
  resolutions: Resolution[];
  shares: Array<{ memberId: string; permission: CrPermission }>;
  asks: Array<{ memberId: string; createdAt: string }>;
  comments: Array<{
    id: string;
    memberId: string;
    kind: CrCommentKind;
    body: string | null;
    opIndex: number | null;
    createdAt: string;
  }>;
};

export type QueueRow = {
  id: string;
  addedByMember: string | null;
  addedByAgent: boolean;
  createdAt: string;
} & ({ kind: 'event'; payload: QueueEventInput } | { kind: 'item'; payload: QueueItemInput });

export type TrackerProject = {
  id: string;
  title: string;
  clientName: string;
  timeZone: string;
  windowStart: string | null;
  asOf: string | null;
  demo: boolean;
  ownerMemberId: string;
};

export type TrackerPayload = {
  project: TrackerProject;
  members: Member[];
  me: Member | null;
  base: TrackerBase;
  queue: TrackerQueue;
  commits: Commit[];
  crs: Cr[];
};
