import { describe, expect, it } from 'vitest';
import {
  changeScroll,
  cutToFit,
  keepInView,
  menuPlace,
} from '../../../src/components/tracker/in-view';

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

describe('changeScroll', () => {
  const base = {
    scrollY: 0,
    viewport: 844,
    scrollHeight: 1184,
    barHeight: 32,
    stickyTop: 53,
    axisHeight: 64,
  };

  it('stays at the top when the first change already sits above the bar', () => {
    expect(changeScroll({ ...base, first: { top: 700, bottom: 720 }, stops: [] })).toBe(0);
  });

  it('stops at the first block that starts past the scroll the change needs', () => {
    // The change needs 160 px; the blocks start 10, 55, 135 and 256 px below the sticky bar.
    const stops = [63, 108, 188, 309];
    expect(changeScroll({ ...base, first: { top: 924, bottom: 948 }, stops })).toBe(256);
  });

  it('skips a block that would push the change under the pinned axis', () => {
    expect(changeScroll({ ...base, first: { top: 924, bottom: 948 }, stops: [900] })).toBe(160);
  });

  it('never asks for more than the page can scroll', () => {
    const page = { ...base, scrollHeight: 1050 };
    expect(changeScroll({ ...page, first: { top: 924, bottom: 948 }, stops: [309] })).toBe(206);
    expect(changeScroll({ ...page, first: { top: 1000, bottom: 1024 }, stops: [] })).toBe(206);
  });

  it('counts from the current scroll', () => {
    const first = { top: 824, bottom: 848 };
    expect(changeScroll({ ...base, scrollY: 100, first, stops: [209] })).toBe(256);
  });
});

describe('menuPlace', () => {
  it('opens below when the menu fits there', () => {
    expect(menuPlace({ below: 200, above: 400, height: 150 })).toEqual({
      up: false,
      maxHeight: null,
    });
  });

  it('opens above when it does not fit below and above has more room', () => {
    expect(menuPlace({ below: 80, above: 400, height: 150 })).toEqual({
      up: true,
      maxHeight: null,
    });
  });

  it('keeps below when above has less room, and scrolls inside when it fits neither side', () => {
    expect(menuPlace({ below: 120, above: 100, height: 150 })).toEqual({
      up: false,
      maxHeight: 120,
    });
    expect(menuPlace({ below: 60, above: 110.6, height: 150 })).toEqual({
      up: true,
      maxHeight: 110,
    });
  });
});
