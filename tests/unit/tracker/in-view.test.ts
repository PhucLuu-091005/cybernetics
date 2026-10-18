import { describe, expect, it } from 'vitest';
import { cutToFit, keepInView } from '../../../src/components/tracker/in-view';

const width = (s: string) => s.length * 6;

describe('keepInView', () => {
  it('keeps a name that starts right of the visible edge where it is', () => {
    expect(keepInView({ x0: 300, x1: 400 }, 300)).toBe('whole');
  });

  it('moves a name that starts left of the edge to just after it, with the room up to its end', () => {
    expect(keepInView({ x0: 250, x1: 400 }, 300)).toEqual({ x: 304, room: 96 });
  });

  it('drops a name whose rest is too short to read', () => {
    expect(keepInView({ x0: 250, x1: 330 }, 300)).toBeNull();
    expect(keepInView({ x0: 100, x1: 200 }, 300)).toBeNull();
  });
});

describe('cutToFit', () => {
  it('keeps a name that fits and cuts a longer one with an ellipsis', () => {
    expect(cutToFit('CRM integration live', 200, width)).toBe('CRM integration live');
    expect(cutToFit('CRM integration live', 96, width)).toBe('CRM integration…');
    expect(cutToFit('CRM integration live', 72, width)).toBe('CRM integra…');
  });

  it('gives no text when fewer than 3 letters fit before the ellipsis', () => {
    expect(cutToFit('CRM integration live', 18, width)).toBeNull();
  });

  it('does not end a cut with a space', () => {
    expect(cutToFit('CRM integration live', 30, width)).toBe('CRM…');
  });
});
