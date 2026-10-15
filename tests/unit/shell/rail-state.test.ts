import { describe, expect, it } from 'vitest';
import { parseRailState, railCookie, RAIL_COOKIE } from '../../../src/components/shell/rail-state';

describe('rail state cookie', () => {
  it('reads collapsed and treats anything else as open', () => {
    expect(parseRailState('collapsed')).toBe('collapsed');
    expect(parseRailState('open')).toBe('open');
    expect(parseRailState(undefined)).toBe('open');
    expect(parseRailState('COLLAPSED')).toBe('open');
    expect(parseRailState('collapsed; Path=/')).toBe('open');
  });
  it('writes a one-year, site-wide, lax cookie', () => {
    expect(RAIL_COOKIE).toBe('pg_rail');
    expect(railCookie('collapsed')).toBe(
      'pg_rail=collapsed; Path=/; Max-Age=31536000; SameSite=Lax',
    );
  });
});
