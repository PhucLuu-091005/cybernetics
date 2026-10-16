import { describe, expect, it } from 'vitest';
import { newProjectBody } from '../../../src/components/shell/new-project';

describe('new project body', () => {
  it('trims both fields and maps them to the contract names', () => {
    expect(newProjectBody('  Brightwater Bank KYC portal ', ' Brightwater Bank ')).toEqual({
      title: 'Brightwater Bank KYC portal',
      clientName: 'Brightwater Bank',
    });
  });
  it('refuses a blank name or a blank client', () => {
    expect(newProjectBody('', 'Client')).toBeNull();
    expect(newProjectBody('Project', '   ')).toBeNull();
  });
  it('accepts exactly the contract limit and refuses one character more', () => {
    expect(newProjectBody('a'.repeat(200), 'b'.repeat(200))).not.toBeNull();
    expect(newProjectBody('a'.repeat(201), 'Client')).toBeNull();
    expect(newProjectBody('Project', 'b'.repeat(201))).toBeNull();
  });
});
