import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSynced, measureOffset, now, resetClock, setOffset, shouldRemeasure } from '../src/core/clock';

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
