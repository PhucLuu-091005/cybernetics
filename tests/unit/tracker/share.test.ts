import { describe, expect, it } from 'vitest';
import { shareCandidates } from '../../../src/components/tracker/Modals';
import type { Cr, Member } from '../../../src/tracker/payload';
import { DEFAULT_GRANTS } from '../../../src/tracker/permissions';

const member = (id: string, active = true): Member => ({
  id,
  name: id,
  roleLabel: '',
  color: '#111',
  userId: null,
  active,
  grants: DEFAULT_GRANTS,
});

describe('shareCandidates', () => {
  it('offers the present members who are not the author, the editor or already shared', () => {
    const cr = {
      author: 'ha',
      editor: 'khoa',
      shares: [
        { memberId: 'khoa', permission: 'edit' },
        { memberId: 'lan', permission: 'view' },
      ],
    } as unknown as Cr;
    const members = ['minh', 'lan', 'quang', 'ha', 'khoa', 'mai'].map((id) =>
      member(id, id !== 'mai'),
    );
    expect(shareCandidates(members, cr).map((m) => m.id)).toEqual(['minh', 'quang']);
  });

  it('leaves out an editor who has no share, after a hand-over from the author', () => {
    const cr = { author: 'ha', editor: 'quang', shares: [] } as unknown as Cr;
    expect(shareCandidates([member('quang'), member('lan')], cr).map((m) => m.id)).toEqual(['lan']);
  });
});
