// The "update available" button (#update). Showing it and its text live in render.ts (showUpdate, paintLocale);
// this wires the click and the reload. Nothing here pauses or reloads on its own.
import { req } from './dom';

/** Calls `apply` when the listener clicks the prompt. Returns an unsubscribe function. */
export function onUpdateClick(apply: () => void): () => void {
  const button = req<HTMLButtonElement>('update');
  const onClick = (): void => apply();
  button.addEventListener('click', onClick);
  return () => button.removeEventListener('click', onClick);
}

/** The reload after the new version takes control. A normal page load: clock, fresh track manifest, resolve. */
export function reloadPage(): void {
  location.reload();
}
