import { describe, expect, it } from 'vitest';
import { errorText } from '../../../src/components/shell/api';

describe('error text', () => {
  it('shows what is wrong with a field instead of the general message', () => {
    expect(
      errorText({
        status: 400,
        code: 'VALIDATION',
        message: 'Invalid invite',
        errors: [{ path: 'email', message: 'Invalid email address' }],
      }),
    ).toBe('Invalid email address.');
  });

  it('names each field problem once', () => {
    expect(
      errorText({
        status: 400,
        code: 'VALIDATION',
        message: 'Invalid team',
        errors: [
          { path: 'name', message: 'Give the team a name' },
          { path: 'name', message: 'Give the team a name' },
          { path: 'leadId', message: 'Pick a lead.' },
        ],
      }),
    ).toBe('Give the team a name. Pick a lead.');
  });

  it('keeps the general message without field problems', () => {
    expect(
      errorText({ status: 409, code: 'CONFLICT', message: 'a@b.co is already in this project' }),
    ).toBe('a@b.co is already in this project.');
    expect(errorText({ status: 400, code: 'VALIDATION', message: 'Invalid', errors: [] })).toBe(
      'Invalid.',
    );
  });
});
