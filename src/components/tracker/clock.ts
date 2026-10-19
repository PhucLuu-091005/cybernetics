import { hourFloor } from '../../tracker/time';

const HOUR = 3_600_000;

type Page = EventTarget & { visibilityState: string };

/** The owner wants hour precision: T, the date and the time-based statuses move once an hour. */
export const hourNow = (timeZone: string) => hourFloor(Date.now(), timeZone);

/**
 * One timeout to the next hour boundary instead of a ticking interval. A sleeping computer or a
 * hidden tab delays timeouts, so showing the tab again or focusing the window reads the clock again.
 */
export function subscribeHour(
  timeZone: string,
  page: Page | undefined = globalThis.document,
  win: EventTarget | undefined = globalThis.window,
) {
  return (onChange: () => void) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      const now = Date.now();
      timer = setTimeout(
        () => {
          onChange();
          arm();
        },
        hourFloor(now, timeZone) + HOUR - now,
      );
    };
    const wake = () => {
      if (page && page.visibilityState !== 'visible') return;
      onChange();
      arm();
    };
    arm();
    page?.addEventListener('visibilitychange', wake);
    win?.addEventListener('focus', wake);
    return () => {
      clearTimeout(timer);
      page?.removeEventListener('visibilitychange', wake);
      win?.removeEventListener('focus', wake);
    };
  };
}
