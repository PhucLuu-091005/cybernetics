import { describe, expect, it } from 'vitest';
import { initialsOf, photoProblem, PHOTO_RULE } from '../../../src/components/settings/photo';

describe('photo picker checks', () => {
  it('takes a PNG, JPEG or WebP up to 5 MB', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp'])
      expect(photoProblem({ type, size: 5 * 1024 * 1024 })).toBeNull();
  });
  it('refuses another type, an empty file and a file over 5 MB with one plain sentence', () => {
    expect(photoProblem({ type: 'image/gif', size: 10 })).toBe(PHOTO_RULE);
    expect(photoProblem({ type: 'text/plain', size: 10 })).toBe(PHOTO_RULE);
    expect(photoProblem({ type: 'image/png', size: 0 })).toBe(PHOTO_RULE);
    expect(photoProblem({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).toBe(PHOTO_RULE);
    expect(PHOTO_RULE).toBe('Use a PNG, JPEG or WebP under 5 MB.');
  });
  it('falls back to two initials', () => {
    expect(initialsOf('Minh  Trần Văn')).toBe('MT');
    expect(initialsOf('lan')).toBe('L');
  });
});
