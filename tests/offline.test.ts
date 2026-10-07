import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine, type EngineState } from '../src/audio/AudioEngine';
import { CACHED_MANIFEST_HEADER, TRACK_MANIFEST_PATH } from '../src/core/swRoute';
import type { Clock, Manifest } from '../src/core/types';
import { loadManifestWithSource } from '../src/net/loadManifest';

const VALID = {
  version: '5166db301c24',
  epoch: '2026-01-01T00:00:00Z',
  totalDuration: 10,
  tracks: [
    { id: 'a', title: { bo: 'བོད', en: 'One' }, artist: { bo: 'མིང་མེད', en: 'Unknown' }, duration: 10, src: 'https://cdn.example/a.mp3' },
  ],
};

describe('loadManifestWithSource: knows when the service worker served the cached track manifest', () => {
  it('fresh from the network: fromCache false', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(VALID), { status: 200 }));
    const r = await loadManifestWithSource(TRACK_MANIFEST_PATH, fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/manifest.json', { cache: 'no-cache' });
    expect(r.fromCache).toBe(false);
    expect(r.manifest.tracks).toHaveLength(1);
  });

  it('the cached fallback (marked by the service worker): fromCache true', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify(VALID), { status: 200, headers: { [CACHED_MANIFEST_HEADER]: 'cached' } }),
    );
    expect((await loadManifestWithSource(TRACK_MANIFEST_PATH, fetchFn)).fromCache).toBe(true);
  });

  it('offline with nothing cached: the network error propagates (boot shows the offline state)', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(loadManifestWithSource(TRACK_MANIFEST_PATH, fetchFn)).rejects.toThrow(/Failed to fetch/);
  });
});

/** Every load fails the way an offline audio request does: an error event, never metadata. */
class OfflineAudio extends EventTarget {
  preload = '';
  src = '';
  currentTime = 0;
  duration = NaN;
  loads = 0;
  play(): Promise<void> {
    this.loads++;
    queueMicrotask(() => this.dispatchEvent(new Event('error')));
    return new Promise(() => {}); // never settles, like a play() on a failed source
  }
  pause(): void {}
}

describe('offline playback attempt: bounded, ends in error, no retry loop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('one retry after 3 s, then error, then no timers left', async () => {
    const manifest: Manifest = { ...VALID, epochMs: Date.parse(VALID.epoch) };
    const el = new OfflineAudio();
    const clock: Clock = { now: () => manifest.epochMs + 5000 };
    const engine = new AudioEngine(manifest, clock, el as unknown as HTMLAudioElement);
    const states: EngineState[] = [];
    engine.on('state', (s) => states.push(s));

    engine.play();
    await vi.runAllTimersAsync();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(engine.state).toBe('error');
    expect(el.loads).toBe(2);
    expect(states).toEqual(['loading', 'error']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
