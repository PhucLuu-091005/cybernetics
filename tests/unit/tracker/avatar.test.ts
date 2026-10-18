import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Avatar, makeDirectory } from '../../../src/components/tracker/avatar';
import { AccountMenu } from '../../../src/components/shell/AccountMenu';
import type { Member } from '../../../src/tracker/payload';
import { DEFAULT_GRANTS } from '../../../src/tracker/permissions';

const PHOTO = `/api/v1/avatars/u1/${'c'.repeat(64)}`;
const member = (id: string, name: string, extra: Partial<Member> = {}): Member => ({
  id,
  name,
  roleLabel: '',
  color: '#123456',
  userId: null,
  active: true,
  removed: false,
  grants: DEFAULT_GRANTS,
  ...extra,
});
const dir = makeDirectory(
  [
    member('minh', 'Minh Trần', { userId: 'u1', photo: PHOTO }),
    member('lan', 'Lan Phạm'),
    member('khoa', 'Khoa Lê', { removed: true, active: false, userId: 'u2', photo: PHOTO }),
  ],
  [{ id: 'sarah', name: 'Sarah Kim' }],
);
const html = (id: string, sm = false) =>
  renderToStaticMarkup(createElement(Avatar, { id, dir, sm }));

describe('Avatar', () => {
  it('shows the photo in the same round box when the person has one', () => {
    expect(html('minh')).toMatch(/^<span class="av" style="background:#123456" title="Minh Trần"/);
    expect(html('minh')).toContain(`<img alt="" `);
    expect(html('minh')).toContain(`class="ph-img"`);
    expect(html('minh')).toContain(`src="${PHOTO}"`);
    expect(html('minh')).not.toContain('MT');
    expect(html('minh', true)).toMatch(/^<span class="av sm"/);
  });
  it('falls back to the initials without a photo, also for story people', () => {
    expect(html('lan')).toContain('>LP</span>');
    expect(html('sarah')).toContain('>SK</span>');
    expect(html('lan')).not.toContain('<img');
  });
  it('keeps the photo of a removed member on past work', () => {
    expect(html('khoa')).toContain(`src="${PHOTO}"`);
  });
  it('shows the photo in the account menu too', () => {
    const menu = (photo?: string) =>
      renderToStaticMarkup(createElement(AccountMenu, { name: 'Minh Trần', photo }));
    expect(menu(PHOTO)).toContain(`src="${PHOTO}"`);
    expect(menu()).toContain('>MT</span>');
  });
});
