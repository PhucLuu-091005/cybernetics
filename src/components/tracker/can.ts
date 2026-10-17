import type { Cr, TrackerPayload } from '../../tracker';

export type ProjectAbility = 'create' | 'merge';
export type CrAbility = 'edit' | 'share' | 'cancel' | 'ask';

const isOpen = (cr: Cr) => cr.status === 'draft' || cr.status === 'ready';

/**
 * Every "may this person …" question of the tracker screens goes through here, so a new permission
 * model changes one function. The server checks the same rules on each write.
 */
export function can(payload: TrackerPayload, ability: ProjectAbility): boolean;
export function can(payload: TrackerPayload, ability: CrAbility, cr: Cr): boolean;
export function can(
  payload: TrackerPayload,
  ability: ProjectAbility | CrAbility,
  cr?: Cr,
): boolean {
  const me = payload.me?.id ?? null;
  if (!me) return false;
  const owner = me === payload.project.ownerMemberId;
  if (ability === 'create') return true;
  if (ability === 'merge') return owner;
  if (!cr) return false;
  switch (ability) {
    case 'edit':
      return cr.status === 'draft' && cr.editor === me;
    case 'share':
      return isOpen(cr) && cr.editor === me;
    case 'cancel':
      return isOpen(cr) && (cr.author === me || cr.editor === me || owner);
    case 'ask':
      return isOpen(cr) && cr.editor !== me;
  }
}
