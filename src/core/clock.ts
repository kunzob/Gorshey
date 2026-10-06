// Clock: the only module allowed to call Date.now() (and the only core module allowed to fetch).

export interface HeadResponse {
  headers: { get(name: string): string | null };
}

export type FetchLike = (url: string, init: { method: string; cache: RequestCache }) => Promise<HeadResponse>;

const REMEASURE_AFTER_MS = 10 * 60 * 1000;

const state = { offset: 0 };

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

/**
 * Measures the device clock against our own origin and stores the median offset.
 * Failed samples are dropped; if none succeed, the offset is 0.
 */
export async function measureOffset(samples = 3, fetchFn: FetchLike = fetch): Promise<number> {
  const values: number[] = [];
  for (let i = 0; i < samples; i++) {
    const offset = await sampleOffset(fetchFn);
    if (offset !== null) values.push(offset);
  }
  state.offset = values.length === 0 ? 0 : median(values);
  return state.offset;
}

/** Corrected current time in ms. */
export function now(): number {
  return Date.now() + state.offset;
}

/** Test hook: overrides the stored offset. */
export function setOffset(ms: number): void {
  state.offset = ms;
}

/** True when more than 10 minutes passed since the last measurement. */
export function shouldRemeasure(lastMeasuredMs: number, nowMs: number): boolean {
  return nowMs - lastMeasuredMs > REMEASURE_AFTER_MS;
}
