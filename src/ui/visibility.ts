/** Calls `onVisible` each time the page becomes visible. Returns an unsubscribe function. */
export function onBecameVisible(onVisible: () => void): () => void {
  const handler = (): void => {
    if (document.visibilityState === 'visible') onVisible();
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
