// Reconnect delay: 1 s doubling to a 30 s cap, with ±20% jitter from an injected random source.
const BASE_MS = 1000;
const CAP_MS = 30_000;

export function backoffDelay(attempt: number, random: () => number): number {
  const base = Math.min(CAP_MS, BASE_MS * 2 ** attempt);
  const jitter = 0.8 + 0.4 * random();
  return Math.round(base * jitter); // whole milliseconds
}
