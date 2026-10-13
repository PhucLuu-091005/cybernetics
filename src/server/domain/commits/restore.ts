import type { ActorContext, CommitPreview, CommitReceipt, PreviewRestoreInput, RestoreCommitInput } from '../../../contracts';
import type { Db } from '../../db/tx';
import { restoreSnapshot } from '../../graph/restore';
import { applyCommit, previewCommit, type CommitOperation } from './preview';

const restore: CommitOperation = {
  kind: 'restore',
  compute: async (_db, _projectId, target) => ({ snapshot: restoreSnapshot(target.snapshot), conflicts: [] }),
};

export function previewRestore(db: Db, ctx: ActorContext, raw: PreviewRestoreInput): Promise<CommitPreview> { return previewCommit(db, ctx, restore, raw); }
export function restoreCommit(db: Db, ctx: ActorContext, raw: RestoreCommitInput): Promise<CommitReceipt> { return applyCommit(db, ctx, restore, raw); }
