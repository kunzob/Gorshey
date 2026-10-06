// Clock: the only module allowed to call Date.now() (and the only core module allowed to fetch).

export interface HeadResponse {
  headers: { get(name: string): string | null };
}

export type FetchLike = (url: string, init: { method: string; cache: RequestCache }) => Promise<HeadResponse>;

export type SyncPrecision = 'none' | 'coarse' | 'refined';

export interface OffsetChange {
  previousOffset: number;
  offset: number;
  precision: SyncPrecision;
}

export interface RefineOptions {
  fetchFn?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxRequests?: number;
  maxMs?: number;
  intervalMs?: number;
}

const REMEASURE_AFTER_MS = 10 * 60 * 1000;
const REFINE_MAX_REQUESTS = 25;
const REFINE_MAX_MS = 3000;
const REFINE_INTERVAL_MS = 100;

// offset: server minus device clock, in ms. precision says how the offset was obtained.
const state: { offset: number; precision: SyncPrecision } = { offset: 0, precision: 'none' };
const listeners = new Set<(change: OffsetChange) => void>();

/** One HEAD round trip. Returns the offset estimate, or null if the sample is unusable. */
async function sampleOffset(fetchFn: FetchLike): Promise<number | null> {
  const t0 = Date.now();
  let res: HeadResponse;
  try {
    res = await fetchFn('/', { method: 'HEAD', cache: 'no-store' });
  } catch {
    return null;
  }
  const t1 = Date.now();
  const header = res.headers.get('date');
  const serverMs = header === null ? Number.NaN : Date.parse(header);
  if (Number.isNaN(serverMs)) return null;
  // +500 centers the 1-second truncation of the Date header.
  return serverMs + 500 - (t0 + t1) / 2;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  // Indices are in range: callers only pass a non-empty array.
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function notify(change: OffsetChange): void {
  listeners.forEach((cb) => cb(change));
}

/**
 * Measures the device clock against our own origin and stores the median offset (coarse: the Date
 * header has 1 s resolution). Failed samples are dropped; if none succeed, the offset is 0 and unsynced.
 */
export async function measureOffset(samples = 3, fetchFn: FetchLike = fetch): Promise<number> {
  const values: number[] = [];
  for (let i = 0; i < samples; i++) {
    const offset = await sampleOffset(fetchFn);
    if (offset !== null) values.push(offset);
  }
  state.precision = values.length > 0 ? 'coarse' : 'none';
  state.offset = values.length > 0 ? median(values) : 0;
  return state.offset;
}

/**
 * Refines the coarse offset using second boundaries. Polls HEAD about every 100 ms. When the server's
 * Date second increases between two consecutive samples, the server's boundary lies between their local
 * midpoints. The offset is then (server boundary − local boundary estimate), and the median over all
 * brackets is kept. Stops at maxRequests or maxMs. With no boundary observed, the coarse offset is kept.
 */
export async function refineOffset(opts: RefineOptions = {}): Promise<{ refined: boolean; offset: number }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxRequests = opts.maxRequests ?? REFINE_MAX_REQUESTS;
  const maxMs = opts.maxMs ?? REFINE_MAX_MS;
  const intervalMs = opts.intervalMs ?? REFINE_INTERVAL_MS;

  const started = Date.now();
  const samples: Array<{ index: number; mid: number; serverMs: number }> = [];
  for (let i = 0; i < maxRequests && Date.now() - started < maxMs; i++) {
    const sendMs = Date.now();
    const serverMs = await headerMs(fetchFn, `/?sync=${i}`);
    const recvMs = Date.now();
    if (!Number.isNaN(serverMs)) samples.push({ index: i, mid: (sendMs + recvMs) / 2, serverMs });
    await sleep(intervalMs);
  }

  const estimates: number[] = [];
  for (let k = 1; k < samples.length; k++) {
    const a = samples[k - 1]!;
    const b = samples[k]!;
    const consecutive = b.index === a.index + 1;
    if (consecutive && b.serverMs - a.serverMs === 1000) {
      estimates.push(b.serverMs - (a.mid + b.mid) / 2);
    }
  }
  if (estimates.length === 0) return { refined: false, offset: state.offset };

  const previousOffset = state.offset;
  state.offset = median(estimates);
  state.precision = 'refined';
  notify({ previousOffset, offset: state.offset, precision: 'refined' });
  return { refined: true, offset: state.offset };
}

/** Server Date header in ms (whole second), or NaN if the request failed or had no usable Date. */
async function headerMs(fetchFn: FetchLike, url: string): Promise<number> {
  try {
    const res = await fetchFn(url, { method: 'HEAD', cache: 'no-store' });
    const header = res.headers.get('date');
    return header === null ? Number.NaN : Date.parse(header);
  } catch {
    return Number.NaN;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when a measurement has been made (coarse or refined). */
export function isSynced(): boolean {
  return state.precision !== 'none';
}

export function syncPrecision(): SyncPrecision {
  return state.precision;
}

export function getOffset(): number {
  return state.offset;
}

/** Subscribes to refinement results. Returns an unsubscribe function. */
export function onOffsetChange(cb: (change: OffsetChange) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Corrected current time in ms. Before a successful sync this is the device clock. */
export function now(): number {
  return Date.now() + state.offset;
}

/** Test hook: overrides the stored offset. */
export function setOffset(ms: number): void {
  state.offset = ms;
}

/** Test hook: back to the initial unsynced state. */
export function resetClock(): void {
  state.offset = 0;
  state.precision = 'none';
}

/** True when more than 10 minutes passed since the last measurement. */
export function shouldRemeasure(lastMeasuredMs: number, nowMs: number): boolean {
  return nowMs - lastMeasuredMs > REMEASURE_AFTER_MS;
}
