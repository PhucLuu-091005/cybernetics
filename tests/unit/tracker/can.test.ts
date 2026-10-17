import { describe, expect, it } from 'vitest';
import { can } from '../../../src/components/tracker/can';
import type { Cr, Member, TrackerPayload } from '../../../src/tracker/payload';

const member = (id: string): Member => ({
  id,
  name: id,
  roleLabel: '',
  color: '#111',
  userId: null,
  active: true,
});

const payloadAs = (me: string | null): TrackerPayload =>
  ({
    project: { ownerMemberId: 'minh' },
    me: me ? member(me) : null,
  }) as TrackerPayload;

const crOf = (status: Cr['status'], over: Partial<Cr> = {}): Cr =>
  ({
    num: 4,
    author: 'ha',
    editor: 'ha',
    status,
    shares: [{ memberId: 'khoa', permission: 'edit' }],
    asks: [],
    ...over,
  }) as Cr;

describe('can', () => {
  it('lets every acting member create a change request, and no one without a member', () => {
    expect(can(payloadAs('lan'), 'create')).toBe(true);
    expect(can(payloadAs(null), 'create')).toBe(false);
  });

  it('lets only the owner of Main merge', () => {
    expect(can(payloadAs('minh'), 'merge')).toBe(true);
    expect(can(payloadAs('ha'), 'merge')).toBe(false);
    expect(can(payloadAs(null), 'merge')).toBe(false);
  });

  it('lets only the current editor edit a draft', () => {
    expect(can(payloadAs('ha'), 'edit', crOf('draft'))).toBe(true);
    expect(can(payloadAs('khoa'), 'edit', crOf('draft'))).toBe(false);
    expect(can(payloadAs('ha'), 'edit', crOf('ready'))).toBe(false);
  });

  it('lets the author, the editor or the owner of Main cancel an open change request', () => {
    const handed = crOf('draft', { editor: 'khoa' });
    expect(can(payloadAs('ha'), 'cancel', handed)).toBe(true);
    expect(can(payloadAs('khoa'), 'cancel', handed)).toBe(true);
    expect(can(payloadAs('minh'), 'cancel', handed)).toBe(true);
    expect(can(payloadAs('lan'), 'cancel', handed)).toBe(false);
    expect(can(payloadAs('ha'), 'cancel', crOf('merged'))).toBe(false);
    expect(can(payloadAs('minh'), 'cancel', crOf('closed'))).toBe(false);
  });

  it('lets any member but the editor ask about an open change request', () => {
    expect(can(payloadAs('lan'), 'ask', crOf('draft'))).toBe(true);
    expect(can(payloadAs('khoa'), 'ask', crOf('ready'))).toBe(true);
    expect(can(payloadAs('ha'), 'ask', crOf('draft'))).toBe(false);
    expect(can(payloadAs(null), 'ask', crOf('draft'))).toBe(false);
    expect(can(payloadAs('lan'), 'ask', crOf('merged'))).toBe(false);
  });

  it('lets the editor share an open change request', () => {
    expect(can(payloadAs('ha'), 'share', crOf('ready'))).toBe(true);
    expect(can(payloadAs('khoa'), 'share', crOf('draft'))).toBe(false);
    expect(can(payloadAs('ha'), 'share', crOf('closed'))).toBe(false);
  });
});
