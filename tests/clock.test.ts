import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOffset,
  isSynced,
  measureOffset,
  now,
  onOffsetChange,
  refineOffset,
  resetClock,
  setOffset,
  shouldRemeasure,
  syncPrecision,
} from '../src/core/clock';

const DATE_HEADER = 'Thu, 01 Jan 2026 00:00:00 GMT';
const SERVER_MS = Date.parse(DATE_HEADER); // whole-second instant, as the Date header carries

type Sample =
  | { kind: 'ok'; t0: number; t1: number; date: string }
  | { kind: 'nodate'; t0: number; t1: number }
  | { kind: 'reject'; t0: number };

// One HEAD sample whose computed offset is exactly `offset`:
// offset = server + 500 - (t0 + t1) / 2  =>  midpoint = server + 500 - offset.
function okSample(offset: number, rttMs = 100): Sample {
  const mid = SERVER_MS + 500 - offset;
  return { kind: 'ok', t0: mid - rttMs / 2, t1: mid + rttMs / 2, date: DATE_HEADER };
}
function nodateSample(): Sample {
  return { kind: 'nodate', t0: 1_000, t1: 1_100 };
}
function rejectSample(): Sample {
  return { kind: 'reject', t0: 1_000 };
}

// Feeds Date.now() the readings a real run would make: t0 before each request,
// t1 after a response arrives (no t1 when the request rejects).
function scriptedClock(samples: Sample[]) {
  const nowSpy = vi.spyOn(Date, 'now');
  for (const s of samples) {
    nowSpy.mockReturnValueOnce(s.t0);
    if (s.kind !== 'reject') nowSpy.mockReturnValueOnce(s.t1);
  }

  let call = 0;
  const fetchFn = vi.fn(async () => {
    const s = samples[call++] as Sample;
    if (s.kind === 'reject') throw new TypeError('network down');
    const date = s.kind === 'ok' ? s.date : null;
    return { headers: { get: (name: string) => (name.toLowerCase() === 'date' ? date : null) } };
  });
  return { fetchFn, nowSpy };
}

describe('clock sync flag', () => {
  beforeEach(() => resetClock());
  afterEach(() => vi.restoreAllMocks());

  it('is false before any measurement', () => {
    expect(isSynced()).toBe(false);
  });

  it('stays false when every sample fails, so callers can tell "measured 0" from "not measured"', async () => {
    const { fetchFn } = scriptedClock([rejectSample(), nodateSample()]);
    expect(await measureOffset(2, fetchFn)).toBe(0);
    expect(isSynced()).toBe(false);
  });

  it('becomes true after at least one successful sample', async () => {
    const { fetchFn } = scriptedClock([rejectSample(), okSample(0)]);
    await measureOffset(2, fetchFn);
    expect(isSynced()).toBe(true);
  });

  it('a later total failure clears a previous sync', async () => {
    const first = scriptedClock([okSample(50)]);
    await measureOffset(1, first.fetchFn);
    expect(isSynced()).toBe(true);
    vi.restoreAllMocks();
    const second = scriptedClock([rejectSample()]);
    await measureOffset(1, second.fetchFn);
    expect(isSynced()).toBe(false);
  });

  it('resetClock() returns to unsynced with offset 0', async () => {
    const { fetchFn } = scriptedClock([okSample(50)]);
    await measureOffset(1, fetchFn);
    resetClock();
    expect(isSynced()).toBe(false);
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    expect(now()).toBe(1000);
  });
});

describe('clock offset', () => {
  beforeEach(() => setOffset(0));
  afterEach(() => vi.restoreAllMocks());

  it('a single sample yields the expected offset', async () => {
    const { fetchFn } = scriptedClock([okSample(250)]);
    expect(await measureOffset(1, fetchFn)).toBe(250);
  });

  it('returns the median of three samples (100, 500, 300 -> 300)', async () => {
    const { fetchFn } = scriptedClock([okSample(100), okSample(500), okSample(300)]);
    expect(await measureOffset(3, fetchFn)).toBe(300);
  });

  it('defaults to three samples', async () => {
    const { fetchFn } = scriptedClock([okSample(0), okSample(0), okSample(0)]);
    await measureOffset(undefined, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('an even number of samples averages the two middle values', async () => {
    const { fetchFn } = scriptedClock([okSample(100), okSample(400), okSample(200), okSample(900)]);
    expect(await measureOffset(4, fetchFn)).toBe(300); // middle two: 200 and 400
  });

  it('sends HEAD to our own origin with cache: no-store', async () => {
    const { fetchFn } = scriptedClock([okSample(0)]);
    await measureOffset(1, fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/', { method: 'HEAD', cache: 'no-store' });
  });

  it('stores the measured offset so now() uses it', async () => {
    const { fetchFn, nowSpy } = scriptedClock([okSample(300)]);
    await measureOffset(1, fetchFn);
    nowSpy.mockReturnValue(1_000_000);
    expect(now()).toBe(1_000_000 + 300);
  });

  it('a rejected request is dropped; the median uses the remaining samples', async () => {
    const { fetchFn } = scriptedClock([okSample(100), rejectSample(), okSample(500)]);
    expect(await measureOffset(3, fetchFn)).toBe(300);
  });

  it('a response with no Date header is dropped', async () => {
    const { fetchFn } = scriptedClock([okSample(200), nodateSample()]);
    expect(await measureOffset(2, fetchFn)).toBe(200);
  });

  it('every sample failing returns offset 0', async () => {
    const { fetchFn } = scriptedClock([rejectSample(), nodateSample(), rejectSample()]);
    expect(await measureOffset(3, fetchFn)).toBe(0);
  });

  it('total failure also resets a previously stored offset to 0', async () => {
    setOffset(999);
    const { fetchFn, nowSpy } = scriptedClock([rejectSample()]);
    await measureOffset(1, fetchFn);
    nowSpy.mockReturnValue(5000);
    expect(now()).toBe(5000);
  });
});

describe('now()', () => {
  beforeEach(() => setOffset(0));
  afterEach(() => vi.restoreAllMocks());

  it('is Date.now() plus the stored offset', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    setOffset(-2500);
    expect(now()).toBe(7500);
  });
});

describe('shouldRemeasure', () => {
  const TEN_MIN = 10 * 60 * 1000;

  it('is false when less than 10 minutes have passed', () => {
    expect(shouldRemeasure(0, TEN_MIN - 1)).toBe(false);
  });

  it('is false at exactly 10 minutes (threshold is "more than")', () => {
    expect(shouldRemeasure(0, TEN_MIN)).toBe(false);
  });

  it('is true once more than 10 minutes have passed', () => {
    expect(shouldRemeasure(0, TEN_MIN + 1)).toBe(true);
  });
});

// ---- second-boundary refinement ----------------------------------------------------------
// Fake world: the device clock reads world.now; the server clock is SERVER_AHEAD ms ahead of it.
// The server stamps each Date header with the whole second its clock is in, as real servers do.
const BASE = Date.parse('Thu, 01 Jan 2026 00:00:00 GMT');
const SERVER_AHEAD = 2345;
const world = { now: BASE };

// Header text for an instant that is a whole second after BASE (under an hour; the fake runs ~30 s).
function headerFor(ms: number): string {
  const k = Math.round((ms - BASE) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Thu, 01 Jan 2026 00:${pad(Math.floor(k / 60))}:${pad(k % 60)} GMT`;
}

// One-way latencies per request (3..7 ms each leg): RTT jitter between 6 and 14 ms.
function legs(i: number): [number, number] {
  return [3 + ((i * 7) % 5), 3 + ((i * 3) % 5)];
}

function serverFetch(opts: { stuck?: boolean } = {}) {
  let i = 0;
  const fetchFn = vi.fn(async () => {
    const [out, back] = legs(i++);
    world.now += out;
    const serverMs = world.now + SERVER_AHEAD;
    const header = opts.stuck ? headerFor(BASE) : headerFor(Math.floor(serverMs / 1000) * 1000);
    world.now += back;
    return { headers: { get: (name: string) => (name.toLowerCase() === 'date' ? header : null) } };
  });
  return fetchFn;
}

const sleep = async (ms: number) => {
  world.now += ms;
};

describe('refineOffset: second-boundary measurement', () => {
  beforeEach(() => {
    world.now = BASE;
    resetClock();
    vi.spyOn(Date, 'now').mockImplementation(() => world.now);
  });
  afterEach(() => vi.restoreAllMocks());

  it('recovers the offset within 100 ms across 20 phases within the second, with RTT jitter', async () => {
    for (let k = 0; k < 20; k++) {
      resetClock();
      world.now = BASE + k * 50; // a different phase of the server second each time
      const result = await refineOffset({ fetchFn: serverFetch(), sleep });
      expect(result.refined).toBe(true);
      expect(Math.abs(getOffset() - SERVER_AHEAD)).toBeLessThan(100);
      expect(syncPrecision()).toBe('refined');
    }
  });

  it('with no second tick observed in the budget, keeps the coarse offset and says so', async () => {
    const coarse = await measureOffset(1, serverFetch());
    expect(syncPrecision()).toBe('coarse');
    const result = await refineOffset({ fetchFn: serverFetch({ stuck: true }), sleep });
    expect(result.refined).toBe(false);
    expect(getOffset()).toBe(coarse);
    expect(syncPrecision()).toBe('coarse');
  });

  it('request budget: at most 25 requests by default', async () => {
    const fetchFn = serverFetch({ stuck: true });
    await refineOffset({ fetchFn, sleep });
    expect(fetchFn).toHaveBeenCalledTimes(25);
  });

  it('time budget: stops at about 3 s even when more requests are allowed', async () => {
    const start = world.now;
    const fetchFn = serverFetch({ stuck: true });
    await refineOffset({ fetchFn, sleep, maxRequests: 1000 });
    expect(world.now - start).toBeLessThanOrEqual(3200);
    expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(31);
  });

  it('notifies listeners once with the previous and new offset when refinement lands', async () => {
    const seen: Array<{ previousOffset: number; offset: number }> = [];
    const off = onOffsetChange((c) => seen.push({ previousOffset: c.previousOffset, offset: c.offset }));
    await refineOffset({ fetchFn: serverFetch(), sleep });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.previousOffset).toBe(0);
    expect(Math.abs(seen[0]!.offset - SERVER_AHEAD)).toBeLessThan(100);
    off();
  });

  it('does not notify listeners when nothing was refined', async () => {
    const seen: number[] = [];
    const off = onOffsetChange(() => seen.push(1));
    await refineOffset({ fetchFn: serverFetch({ stuck: true }), sleep });
    expect(seen).toHaveLength(0);
    off();
  });
});

describe('refineOffset: failed samples and defaults', () => {
  beforeEach(() => {
    world.now = BASE;
    resetClock();
    vi.spyOn(Date, 'now').mockImplementation(() => world.now);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a rejected request or a response with no Date is skipped; refinement still lands', async () => {
    const good = serverFetch();
    let n = 0;
    const fetchFn = vi.fn(async (url: string, init: { method: string; cache: RequestCache }) => {
      const k = n++;
      if (k % 6 === 2) throw new TypeError('network down');
      if (k % 6 === 4) return { headers: { get: () => null } };
      void url;
      void init;
      return good();
    });
    const result = await refineOffset({ fetchFn, sleep });
    expect(result.refined).toBe(true);
    expect(Math.abs(getOffset() - SERVER_AHEAD)).toBeLessThan(100);
  });

  it('with no injected fetch or sleep, it uses the global fetch and a real timer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ headers: { get: () => headerFor(BASE) } })));
    const result = await refineOffset({ maxRequests: 3, intervalMs: 1 });
    expect(result.refined).toBe(false); // a stuck header never ticks, so the coarse offset is kept
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });
});
