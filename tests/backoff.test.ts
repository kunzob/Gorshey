import { describe, expect, it } from 'vitest';
import { backoffDelay } from '../src/presence/backoff';
import { readConfig } from '../src/presence/config';

describe('backoff schedule', () => {
  const mid = () => 0.5; // no jitter
  it('doubles from 1 s and caps at 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((a) => backoffDelay(a, mid))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it('jitter is ±20% around the base delay', () => {
    expect(backoffDelay(2, () => 0)).toBe(3200); // 4000 × 0.8
    expect(backoffDelay(2, () => 1)).toBeCloseTo(4800, 6); // 4000 × 1.2
  });

  it('the jittered delay never exceeds 36 s (30 s cap × 1.2)', () => {
    expect(backoffDelay(50, () => 1)).toBeLessThanOrEqual(36_000);
  });
});

describe('config from the repo env names', () => {
  it('reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY and nothing else', () => {
    expect(readConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc' })).toEqual({
      url: 'https://x.supabase.co',
      key: 'sb_publishable_abc',
    });
  });

  it('a missing URL or key means no config (presence disabled)', () => {
    expect(readConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toBeNull();
    expect(readConfig({ VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull();
    expect(readConfig({})).toBeNull();
  });

  it('an empty value counts as missing', () => {
    expect(readConfig({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull();
  });
});
