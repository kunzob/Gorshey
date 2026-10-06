import { describe, expect, it } from 'vitest';
import { buildIndex, resolve } from '../src/core/schedule';

// Exact durations from public/manifest.json (hardcoded on purpose: adding a track later must not change these asserts).
const REAL_DURATIONS = [211.255167, 245.179521];
const REAL_TOTAL = 456.434688;
const EPOCH = 1_767_225_600_000; // 2026-01-01T00:00:00Z in ms

// Small integer playlist: every boundary is exact in floating point.
const SYNTH = [2, 3]; // total 5 s

describe('buildIndex', () => {
  it('returns cumulative starts with the total as the last entry (real fixture)', () => {
    const starts = buildIndex(REAL_DURATIONS.map((duration) => ({ duration })));
    expect(starts).toHaveLength(3);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBeCloseTo(211.255167, 9);
    expect(starts[2]).toBeCloseTo(REAL_TOTAL, 9);
  });

  it('handles a single track', () => {
    expect(buildIndex([{ duration: 10 }])).toEqual([0, 10]);
  });

  it('throws on an empty playlist', () => {
    expect(() => buildIndex([])).toThrow(/empty/i);
  });
});

describe('resolve', () => {
  const starts = buildIndex(SYNTH.map((duration) => ({ duration })));

  it('before the epoch wraps backwards into the loop', () => {
    // now = epoch - 1 s  ->  loopPos = 5 - 1 = 4  ->  track 1 (starts at 2), offset 2
    const pos = resolve(EPOCH - 1000, EPOCH, starts);
    expect(pos.trackIdx).toBe(1);
    expect(pos.offsetSec).toBe(2);
    expect(pos.endsAtMs).toBe(EPOCH - 1000 + 1000);
  });

  it('exactly at the epoch is track 0, offset 0', () => {
    const pos = resolve(EPOCH, EPOCH, starts);
    expect(pos).toEqual({ trackIdx: 0, offsetSec: 0, endsAtMs: EPOCH + 2000 });
  });

  it('exactly on a track boundary is offset 0 of the next track', () => {
    const pos = resolve(EPOCH + 2000, EPOCH, starts);
    expect(pos).toEqual({ trackIdx: 1, offsetSec: 0, endsAtMs: EPOCH + 5000 });
  });

  it('the last track wraps to track 0 when the loop completes', () => {
    const pos = resolve(EPOCH + 5000, EPOCH, starts);
    expect(pos.trackIdx).toBe(0);
    expect(pos.offsetSec).toBe(0);
    expect(pos.endsAtMs).toBe(EPOCH + 7000);
  });

  it('many loops later (large now) resolves to the same position as the loop offset', () => {
    // 1_000_000_003 s since epoch; mod 5 = 3 -> track 1, offset 1, ends in 2 s
    const now = EPOCH + 1_000_000_003_000;
    const pos = resolve(now, EPOCH, starts);
    expect(pos).toEqual({ trackIdx: 1, offsetSec: 1, endsAtMs: now + 2000 });
  });

  it('single-track playlist always resolves to track 0 and wraps on its own length', () => {
    const one = buildIndex([{ duration: 10 }]);
    const pos = resolve(EPOCH + 25_000, EPOCH, one);
    expect(pos).toEqual({ trackIdx: 0, offsetSec: 5, endsAtMs: EPOCH + 30_000 });
  });

  it('float durations (real fixture): mid-track-1 position', () => {
    const starts = buildIndex(REAL_DURATIONS.map((duration) => ({ duration })));
    const pos = resolve(EPOCH + 300_000, EPOCH, starts); // 300 s in
    expect(pos.trackIdx).toBe(1);
    expect(pos.offsetSec).toBeCloseTo(300 - 211.255167, 9);
    // endsAtMs is ~1.7e12, where doubles resolve only ~2e-4 ms, so allow 1 ms.
    expect(Math.abs(pos.endsAtMs - (EPOCH + 300_000 + (REAL_TOTAL - 300) * 1000))).toBeLessThan(1);
  });

  it('float durations (real fixture): 211.3 s in is inside track 1, just past its start', () => {
    const starts = buildIndex(REAL_DURATIONS.map((duration) => ({ duration })));
    const pos = resolve(EPOCH + 211_300, EPOCH, starts);
    expect(pos.trackIdx).toBe(1);
    expect(pos.offsetSec).toBeCloseTo(211.3 - 211.255167, 9);
  });

  it('float durations (real fixture): one loop and a bit wraps to track 0', () => {
    const starts = buildIndex(REAL_DURATIONS.map((duration) => ({ duration })));
    const pos = resolve(EPOCH + (REAL_TOTAL + 10) * 1000, EPOCH, starts);
    expect(pos.trackIdx).toBe(0);
    expect(pos.offsetSec).toBeCloseTo(10, 6);
  });
});
