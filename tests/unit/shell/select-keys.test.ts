import { describe, expect, it } from 'vitest';
import { activeOnOpen, moveActive, typeahead } from '../../../src/components/tracker/select-keys';
import { selectAllState, toggleAll } from '../../../src/components/settings/scopes';
import type { Scope } from '../../../src/contracts';

const people = [
  { value: '', label: 'Nobody', disabled: true },
  { value: 'lan', label: 'Lan Phạm' },
  { value: 'minh', label: 'Minh Trần' },
  { value: 'khoa', label: 'Khoa Lê', disabled: true },
  { value: 'ha', label: 'Hà Đỗ' },
  { value: 'linh', label: 'Linh Võ' },
];
const many = Array.from({ length: 20 }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` }));

describe('Select keys', () => {
  it('opens at the current value, or at the first option that can be picked', () => {
    expect(activeOnOpen(people, 'minh')).toBe(2);
    expect(activeOnOpen(people, '')).toBe(1);
    expect(activeOnOpen(people, 'khoa')).toBe(1);
    expect(activeOnOpen([{ value: 'x', label: 'X', disabled: true }], 'x')).toBe(-1);
  });
  it('moves with the arrows, Home and End, and skips options that cannot be picked', () => {
    expect(moveActive(people, 2, 'ArrowDown')).toBe(4);
    expect(moveActive(people, 4, 'ArrowUp')).toBe(2);
    expect(moveActive(people, 1, 'ArrowUp')).toBe(1);
    expect(moveActive(people, 5, 'ArrowDown')).toBe(5);
    expect(moveActive(people, 4, 'Home')).toBe(1);
    expect(moveActive(people, 1, 'End')).toBe(5);
  });
  it('moves a page with Page Up and Page Down, and stops at the ends', () => {
    expect(moveActive(many, 0, 'PageDown')).toBe(8);
    expect(moveActive(many, 15, 'PageDown')).toBe(19);
    expect(moveActive(many, 10, 'PageUp')).toBe(2);
    expect(moveActive(many, 3, 'PageUp')).toBe(0);
    expect(moveActive(people, 1, 'PageDown')).toBe(5);
  });
  it('jumps to the next option that starts with the typed letters, accents ignored', () => {
    expect(typeahead(people, 2, 'l')).toBe(5);
    expect(typeahead(people, 5, 'l')).toBe(1);
    expect(typeahead(people, 1, 'li')).toBe(5);
    expect(typeahead(people, 1, 'ha')).toBe(4);
    expect(typeahead(people, 1, 'k')).toBe(1);
    expect(typeahead(people, 1, 'zz')).toBe(1);
  });
});

describe('Select all checkbox', () => {
  const allowed: Scope[] = ['project:read', 'queue:add', 'crs:edit'];
  it('turns a mixed Select all into all, then all into none', () => {
    const mixed = new Set<Scope>(['queue:add']);
    expect(selectAllState(mixed, allowed)).toBe('some');
    const all = toggleAll(mixed, allowed);
    expect(selectAllState(all, allowed)).toBe('all');
    expect(selectAllState(toggleAll(all, allowed), allowed)).toBe('none');
  });
});
