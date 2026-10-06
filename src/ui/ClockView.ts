import { formatTime } from '../i18n/i18n';

/** Shows the local time from the corrected clock, once a second. Returns a stop function. */
export function startClock(el: HTMLElement, now: () => number): () => void {
  const paint = (): void => {
    el.textContent = formatTime(now());
  };
  paint();
  const timer = setInterval(paint, 1000);
  return () => clearInterval(timer);
}
