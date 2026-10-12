import { formatTime } from '../i18n/i18n';

/**
 * Shows the local time from the corrected clock, once a second. `onTick` runs after each paint; the player uses it to
 * follow the schedule while paused (no second timer). Returns a stop function.
 */
export function startClock(el: HTMLElement, now: () => number, onTick?: () => void): () => void {
  const paint = (): void => {
    el.textContent = formatTime(now());
    onTick?.();
  };
  paint();
  const timer = setInterval(paint, 1000);
  return () => clearInterval(timer);
}
