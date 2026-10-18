import { MAX_PHOTO_BYTES, PHOTO_RULE, PHOTO_TYPES } from '../../contracts/photo';

export { PHOTO_RULE, PHOTO_TYPES };

/** A quick check in the browser; the server reads the bytes and decides. */
export function photoProblem(file: { type: string; size: number }): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return PHOTO_RULE;
  if (file.size === 0 || file.size > MAX_PHOTO_BYTES) return PHOTO_RULE;
  return null;
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
