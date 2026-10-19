import { afterEach, describe, expect, it, vi } from 'vitest';
import { hourNow, subscribeHour } from '../../../src/components/tracker/clock';
import { hourFloor } from '../../../src/tracker/time';

const HOUR = 3_600_000;
const at = (iso: string) => Date.parse(iso);

describe('hourFloor', () => {
  it('rounds down to the start of the hour on the clock of the time zone', () => {
    expect(hourFloor(at('2026-10-19T15:59:59+07:00'), 'Asia/Ho_Chi_Minh')).toBe(
      at('2026-10-19T15:00:00+07:00'),
    );
    expect(hourFloor(at('2026-10-19T16:00:00+07:00'), 'Asia/Ho_Chi_Minh')).toBe(
      at('2026-10-19T16:00:00+07:00'),
    );
    // A zone half an hour off UTC still lands on its own whole hour.
    expect(hourFloor(at('2026-10-19T10:20:00+05:30'), 'Asia/Kolkata')).toBe(
      at('2026-10-19T10:00:00+05:30'),
    );
  });
});

describe('the hour clock of the graph', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const page = () => {
    const doc = new EventTarget() as EventTarget & { visibilityState: string };
    doc.visibilityState = 'visible';
    return doc;
  };

  it('reads the hour floor as its snapshot', () => {
    vi.useFakeTimers({ now: at('2026-10-19T15:42:10+07:00') });
    expect(hourNow('Asia/Ho_Chi_Minh')).toBe(at('2026-10-19T15:00:00+07:00'));
  });

  it('wakes once at each hour boundary and never before it', () => {
    vi.useFakeTimers({ now: at('2026-10-19T15:42:10+07:00') });
    const changed = vi.fn();
    const stop = subscribeHour('Asia/Ho_Chi_Minh', page())(changed);
    vi.advanceTimersByTime(at('2026-10-19T16:00:00+07:00') - Date.now() - 1);
    expect(changed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(hourNow('Asia/Ho_Chi_Minh')).toBe(at('2026-10-19T16:00:00+07:00'));
    vi.advanceTimersByTime(HOUR - 2_000);
    expect(changed).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reads the clock again when the tab shows or the window gets the focus back', () => {
    vi.useFakeTimers({ now: at('2026-10-19T15:42:10+07:00') });
    const doc = page();
    const win = new EventTarget();
    const changed = vi.fn();
    const stop = subscribeHour('Asia/Ho_Chi_Minh', doc, win)(changed);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(changed).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(changed).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event('focus'));
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
