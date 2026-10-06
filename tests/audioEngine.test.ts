import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine, type EngineState } from '../src/audio/AudioEngine';
import type { Clock, Manifest } from '../src/core/types';

// Fixtures mirror public/manifest.json (M1). The durations are copied, not read at test time,
// so adding a track later does not silently change these assertions. Update both if the manifest changes.
const EPOCH_MS = Date.parse('2026-01-01T00:00:00Z');
const TRACK0_SRC = 'https://cdn.test/audio/bd4e9fd47041.mp3';
const TRACK1_SRC = 'https://cdn.test/audio/283d75d6d29d.mp3';
const REAL_MANIFEST: Manifest = {
  version: '5166db301c24',
  epoch: '2026-01-01T00:00:00Z',
  epochMs: EPOCH_MS,
  totalDuration: 456.434688,
  tracks: [
    {
      id: 'bd4e9fd47041',
      title: { bo: 'མ་ནི་ཡིག་དྲུག', en: 'Song of Mani' },
      artist: { bo: 'མིང་མེད', en: 'Unknown' },
      duration: 211.255167,
      src: TRACK0_SRC,
    },
    {
      id: '283d75d6d29d',
      title: { bo: 'རྟེན་འབྲེལ་དགའ་བསྲུ།', en: 'Auspicious Welcome' },
      artist: { bo: 'མིང་མེད', en: 'Unknown' },
      duration: 245.179521,
      src: TRACK1_SRC,
    },
  ],
};

// Synthetic 2 s + 3 s playlist: every boundary is exact in floating point.
const SYNTH_MANIFEST: Manifest = {
  ...REAL_MANIFEST,
  totalDuration: 5,
  tracks: [
    { ...REAL_MANIFEST.tracks[0]!, id: 's0', duration: 2, src: 'synth0' },
    { ...REAL_MANIFEST.tracks[1]!, id: 's1', duration: 3, src: 'synth1' },
  ],
};

/**
 * Stand-in for HTMLAudioElement. Tracks writes to currentTime made before loadedmetadata
 * (which the engine must never do) and resets metadata readiness when src changes.
 */
class FakeAudio extends EventTarget {
  preload = '';
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  metadataReady = false;
  writesBeforeMetadata = 0;
  playImpl: () => Promise<void> = () => Promise.resolve();
  private _src = '';
  private _t = 0;
  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, cb: EventListenerOrEventListenerObject | null): void {
    if (!cb) return;
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
    super.addEventListener(type, cb);
  }
  removeEventListener(type: string, cb: EventListenerOrEventListenerObject | null): void {
    if (!cb) return;
    this.listeners.get(type)?.delete(cb);
    super.removeEventListener(type, cb);
  }
  /** Number of listeners currently attached, across all event types. */
  activeListeners(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }

  get src(): string {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    this.metadataReady = false;
  }
  get currentTime(): number {
    return this._t;
  }
  set currentTime(v: number) {
    if (!this.metadataReady) this.writesBeforeMetadata++;
    this._t = v;
  }
  play(): Promise<void> {
    this.playCalls++;
    this.paused = false;
    return this.playImpl();
  }
  pause(): void {
    this.pauseCalls++;
    this.paused = true;
  }

  /** Simulates the browser finishing metadata load for the current src. */
  loadMetadata(): void {
    this.metadataReady = true;
    this.dispatchEvent(new Event('loadedmetadata'));
  }
  fire(name: string): void {
    this.dispatchEvent(new Event(name));
  }
}

interface Harness {
  engine: AudioEngine;
  el: FakeAudio;
  clock: { t: number; now: () => number };
  states: EngineState[];
  tracks: number[];
  ticks: Array<{ trackIdx: number; positionSec: number }>;
}

function setup(manifest: Manifest = REAL_MANIFEST, startMs = EPOCH_MS): Harness {
  const el = new FakeAudio();
  const clock = { t: startMs, now: () => clock.t };
  const engine = new AudioEngine(manifest, clock as Clock, el as unknown as HTMLAudioElement);
  const states: EngineState[] = [];
  const tracks: number[] = [];
  const ticks: Array<{ trackIdx: number; positionSec: number }> = [];
  engine.on('state', (s) => states.push(s));
  engine.on('track', (i) => tracks.push(i));
  engine.on('tick', (t) => ticks.push(t));
  return { engine, el, clock, states, tracks, ticks };
}

/** Starts the engine and returns once the element is loading. */
function startPlaying(h: Harness): void {
  h.engine.play();
  h.el.loadMetadata();
  h.el.fire('playing');
}

const SEC = 1000;

describe('AudioEngine: first play', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('play() sets the track src and calls el.play() synchronously, in the tap', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS + 50 * SEC);
    h.engine.play();
    expect(h.el.src).toBe(TRACK0_SRC);
    expect(h.el.playCalls).toBe(1);
    expect(h.engine.state).toBe('loading');
  });

  it('never writes currentTime before loadedmetadata', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS + 50 * SEC);
    h.engine.play();
    expect(h.el.writesBeforeMetadata).toBe(0);
    h.el.loadMetadata();
    expect(h.el.writesBeforeMetadata).toBe(0);
  });

  it('after loadedmetadata, seeks to the clock-derived offset (50 s into track 0), then playing', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS + 50 * SEC);
    h.engine.play();
    h.el.loadMetadata();
    expect(h.el.currentTime).toBeCloseTo(50, 6);
    h.el.fire('playing');
    expect(h.engine.state).toBe('playing');
    expect(h.states).toEqual(['loading', 'playing']);
  });

  it('emits track 0 on first play', () => {
    const h = setup();
    h.engine.play();
    expect(h.tracks).toEqual([0]);
  });
});

describe('AudioEngine: ended', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('re-resolves from the clock instead of advancing idx+1 (last track wraps to track 0)', () => {
    // Playing the last track (index 1) when the loop wraps. idx+1 would be index 2, which does not exist.
    const h = setup(REAL_MANIFEST, EPOCH_MS + 300 * SEC);
    startPlaying(h);
    expect(h.tracks).toEqual([1]);

    h.clock.t = EPOCH_MS + (456.434688 + 1) * SEC; // next loop, 1 s into track 0
    h.el.fire('ended');
    expect(h.el.src).toBe(TRACK0_SRC);
    expect(h.tracks).toEqual([1, 0]);
    h.el.loadMetadata();
    expect(h.el.currentTime).toBeCloseTo(1, 6);
  });

  it('after ended at the end of track 0, loads track 1 at offset 0 when the clock agrees', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS);
    startPlaying(h);
    h.clock.t = EPOCH_MS + 211.255167 * SEC; // clock has reached track 1 start
    h.el.fire('ended');
    // Float note: 211.255167 s in ms resolves to 211.2551669921875, just under the boundary, so the
    // clock-lag path (timer at endsAtMs, ~0 ms away) handles it. Real time moves on while the timer waits,
    // so the clock advances 1 ms too.
    h.clock.t += 1;
    vi.advanceTimersByTime(1);
    expect(h.el.src).toBe(TRACK1_SRC);
    expect(h.tracks).toEqual([0, 1]);
    h.el.loadMetadata();
    expect(h.el.currentTime).toBeCloseTo(0.001, 6); // clock is 1 ms into track 1
  });

  it('clock lag: if re-resolve still returns the ended track, re-resolves at endsAtMs', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS + 211 * SEC);
    startPlaying(h);
    // ended fires while the clock still says track 0 (~0.255 s left): no reload yet, only a timer.
    h.el.fire('ended');
    expect(h.el.src).toBe(TRACK0_SRC);
    expect(h.el.playCalls).toBe(1);

    h.clock.t = EPOCH_MS + 211.3 * SEC; // clock has now passed the boundary
    vi.advanceTimersByTime(300);
    expect(h.el.src).toBe(TRACK1_SRC);
    expect(h.tracks).toEqual([0, 1]);
  });
});

describe('AudioEngine: pause then play', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pause() leaves live; play() rejoins the live position, never the stale one', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS + 10 * SEC);
    startPlaying(h);
    h.engine.pause();
    expect(h.engine.state).toBe('paused');
    expect(h.el.pauseCalls).toBe(1);

    h.clock.t = EPOCH_MS + 70 * SEC; // a minute later
    h.engine.play();
    h.el.loadMetadata();
    expect(h.el.currentTime).toBeCloseTo(70, 6);
    expect(h.el.currentTime).not.toBeCloseTo(10, 6);
  });
});

describe('AudioEngine: visibility re-sync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('drift greater than 2 s on the same track re-syncs the position', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS + 50 * SEC);
    startPlaying(h);
    h.el.currentTime = 40; // element fell 10 s behind the clock (50 s)
    h.engine.onVisible();
    expect(h.el.currentTime).toBeCloseTo(50, 6);
  });

  it('drift of 2 s or less is tolerated: no seek', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS + 50 * SEC);
    startPlaying(h);
    h.el.currentTime = 49; // 1 s behind
    const before = h.el.writesBeforeMetadata;
    h.engine.onVisible();
    expect(h.el.currentTime).toBe(49);
    expect(h.el.writesBeforeMetadata).toBe(before);
  });

  it('a track change while hidden loads the new track', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS + 100 * SEC);
    startPlaying(h);
    h.clock.t = EPOCH_MS + 230 * SEC; // now in track 1
    h.engine.onVisible();
    expect(h.el.src).toBe(TRACK1_SRC);
    expect(h.tracks).toEqual([0, 1]);
  });
});

describe('AudioEngine: tick', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits tick every 250 ms while playing with the clock-derived position', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS + 20 * SEC);
    startPlaying(h);
    h.clock.t += 250;
    vi.advanceTimersByTime(250);
    expect(h.ticks.at(-1)).toEqual({ trackIdx: 0, positionSec: 20.25 });
  });

  it('detects a track boundary crossed without an ended event and switches tracks', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS + 211 * SEC);
    startPlaying(h);
    h.clock.t = EPOCH_MS + 212 * SEC; // boundary passed silently
    vi.advanceTimersByTime(250);
    expect(h.el.src).toBe(TRACK1_SRC);
    expect(h.tracks).toEqual([0, 1]);
  });

  it('stops ticking on pause', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS);
    startPlaying(h);
    h.engine.pause();
    const n = h.ticks.length;
    vi.advanceTimersByTime(2000);
    expect(h.ticks.length).toBe(n);
  });
});

describe('AudioEngine: stalls', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waiting and stalled move playing to buffering; playing recovers', () => {
    const h = setup();
    startPlaying(h);
    h.el.fire('waiting');
    expect(h.engine.state).toBe('buffering');
    h.el.fire('playing');
    expect(h.engine.state).toBe('playing');

    h.el.fire('stalled');
    expect(h.engine.state).toBe('buffering');
    h.el.fire('playing');
    expect(h.engine.state).toBe('playing');
  });
});

describe('AudioEngine: errors', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('first error retries once after 3 s, re-resolving from the clock (not the old position)', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS + 30 * SEC);
    startPlaying(h);
    h.el.fire('error');
    expect(h.engine.state).toBe('loading');
    expect(h.el.playCalls).toBe(1); // no retry yet

    h.clock.t = EPOCH_MS + 90 * SEC; // time has moved on while waiting to retry
    vi.advanceTimersByTime(3000);
    expect(h.el.playCalls).toBe(2);
    h.el.loadMetadata();
    expect(h.el.currentTime).toBeCloseTo(90, 6);
  });

  it('a second error after the retry enters the error state', () => {
    const h = setup();
    startPlaying(h);
    h.el.fire('error');
    vi.advanceTimersByTime(3000);
    h.el.fire('error');
    expect(h.engine.state).toBe('error');
    vi.advanceTimersByTime(10_000);
    expect(h.el.playCalls).toBe(2); // no further retries
  });

  it('error → play() re-syncs to the live position and retries (error → loading)', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS + 30 * SEC);
    startPlaying(h);
    h.el.fire('error');
    vi.advanceTimersByTime(3000);
    h.el.fire('error'); // retry failed too: error state
    expect(h.engine.state).toBe('error');

    h.clock.t = EPOCH_MS + 120 * SEC;
    h.engine.play();
    expect(h.engine.state).toBe('loading');
    h.el.loadMetadata();
    expect(h.el.currentTime).toBeCloseTo(120, 6);
  });

  it('pressing play after the error state starts again', () => {
    const h = setup();
    startPlaying(h);
    h.el.fire('error');
    vi.advanceTimersByTime(3000);
    h.el.fire('error');
    h.engine.play();
    expect(h.engine.state).toBe('loading');
    expect(h.el.playCalls).toBe(3);
  });

  it('a late retry timer after pause starts no playback', () => {
    const h = setup();
    startPlaying(h);
    h.el.fire('error');
    h.engine.pause();
    vi.advanceTimersByTime(5000);
    expect(h.el.playCalls).toBe(1);
    expect(h.engine.state).toBe('paused');
  });
});

describe('AudioEngine: reload cap', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('after 3 consecutive reloads without reaching playing, the next reload enters error', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS + 200 * SEC);
    startPlaying(h); // reaching playing resets the reload count
    expect(h.el.playCalls).toBe(1);

    // Reload 1: the tick sees a boundary crossed silently.
    h.clock.t = EPOCH_MS + 212 * SEC;
    vi.advanceTimersByTime(250);
    expect(h.el.src).toBe(TRACK1_SRC);
    expect(h.el.playCalls).toBe(2);

    // Reload 2: loadedmetadata finds the clock back in track 0 (the track changed again).
    h.clock.t = EPOCH_MS + 10 * SEC;
    h.el.loadMetadata();
    expect(h.el.src).toBe(TRACK0_SRC);
    expect(h.el.playCalls).toBe(3);

    // Reload 3: a retry after an error (the error uses the one retry from reaching playing).
    h.el.fire('error');
    vi.advanceTimersByTime(3000);
    expect(h.el.playCalls).toBe(4);
    expect(h.engine.state).toBe('loading');

    // Reload 4 would be the fourth consecutive reload: capped.
    h.clock.t = EPOCH_MS + 230 * SEC;
    h.el.loadMetadata();
    expect(h.engine.state).toBe('error');
    expect(h.el.playCalls).toBe(4);
    vi.advanceTimersByTime(10_000);
    expect(h.el.playCalls).toBe(4);
  });

  it('reaching playing resets the cap', () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS + 200 * SEC);
    startPlaying(h);
    h.clock.t = EPOCH_MS + 212 * SEC;
    vi.advanceTimersByTime(250); // reload 1
    h.el.fire('playing'); // reached playing: counter resets
    h.clock.t = EPOCH_MS + 10 * SEC;
    h.el.loadMetadata(); // reload 1 again, not 2
    h.el.fire('playing');
    h.clock.t = EPOCH_MS + 212 * SEC;
    vi.advanceTimersByTime(250);
    expect(h.engine.state).toBe('loading');
    expect(h.el.src).toBe(TRACK1_SRC);
  });
});

describe('AudioEngine: play() rejected while loading', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('leaves no pending handler or timer that can start playback later', async () => {
    const h = setup(REAL_MANIFEST, EPOCH_MS + 30 * SEC);
    let rejectPlay: (e: unknown) => void = () => {};
    h.el.playImpl = () => new Promise<void>((_, reject) => (rejectPlay = reject));
    h.engine.play();
    expect(h.engine.state).toBe('loading');

    rejectPlay(new DOMException('blocked', 'NotAllowedError'));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(h.engine.state).toBe('paused');
    expect(h.el.pauseCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    // Late events from the abandoned load must not start playback.
    h.el.loadMetadata();
    h.el.fire('playing');
    h.el.fire('error');
    vi.advanceTimersByTime(10_000);
    expect(h.engine.state).toBe('paused');
    expect(h.el.playCalls).toBe(1);
    expect(h.el.writesBeforeMetadata).toBe(0);
  });
});

describe('AudioEngine: pause during loading', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a late loadedmetadata after pause does not start playback or seek', () => {
    const h = setup();
    h.engine.play();
    h.engine.pause();
    h.el.loadMetadata();
    h.el.fire('playing');
    expect(h.el.writesBeforeMetadata).toBe(0);
    expect(h.el.currentTime).toBe(0);
    expect(h.engine.state).toBe('paused');
    expect(h.el.playCalls).toBe(1);
  });
});

describe('AudioEngine: play() rejection', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('NotAllowedError returns to a tappable paused state, not stuck in loading', async () => {
    const h = setup();
    h.el.playImpl = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    h.engine.play();
    for (let i = 0; i < 5; i++) await Promise.resolve(); // let the rejection handler run
    expect(h.engine.state).toBe('paused');

    h.el.playImpl = () => Promise.resolve();
    h.engine.play();
    expect(h.engine.state).toBe('loading');
    expect(h.el.playCalls).toBe(2);
  });
});

describe('AudioEngine: idempotence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('play() twice loads once', () => {
    const h = setup();
    h.engine.play();
    h.engine.play();
    expect(h.el.playCalls).toBe(1);
    expect(h.tracks).toEqual([0]);
  });

  it('pause() while idle changes nothing and emits nothing', () => {
    const h = setup();
    h.engine.pause();
    expect(h.engine.state).toBe('idle');
    expect(h.el.pauseCalls).toBe(0);
    expect(h.states).toEqual([]);
  });
});

describe('AudioEngine: boundary', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('exactly on a track boundary resolves to the next track at offset 0', () => {
    const h = setup(SYNTH_MANIFEST, EPOCH_MS + 2 * SEC); // boundary of the 2 s + 3 s playlist
    h.engine.play();
    expect(h.el.src).toBe('synth1');
    h.el.loadMetadata();
    expect(h.el.currentTime).toBe(0);
  });
});

describe('AudioEngine: persistent element', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('creates exactly one Audio element and reuses it across track changes and pauses', () => {
    const made: FakeAudio[] = [];
    vi.stubGlobal(
      'Audio',
      class {
        constructor() {
          const el = new FakeAudio();
          made.push(el);
          return el as unknown as HTMLAudioElement;
        }
      },
    );
    const clock = { t: EPOCH_MS + 200 * SEC, now: () => clock.t };
    const engine = new AudioEngine(REAL_MANIFEST, clock);

    engine.play();
    made[0]!.loadMetadata();
    clock.t = EPOCH_MS + 212 * SEC; // clock has moved into track 1
    made[0]!.fire('ended');
    engine.pause();
    engine.play();

    expect(made).toHaveLength(1);
    expect(made[0]!.src).toBe(TRACK1_SRC);
    engine.destroy();
  });
});

describe('AudioEngine: destroy', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('leaves no timers, no listeners and no further events', () => {
    const h = setup();
    startPlaying(h);
    expect(h.el.activeListeners()).toBeGreaterThan(0);
    h.el.fire('error'); // schedules a retry timer
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    h.engine.destroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(h.el.activeListeners()).toBe(0);

    const playsBefore = h.el.playCalls;
    const eventsBefore = h.states.length + h.ticks.length;
    vi.advanceTimersByTime(10_000);
    h.el.fire('ended');
    h.el.fire('playing');
    expect(h.el.playCalls).toBe(playsBefore);
    expect(h.states.length + h.ticks.length).toBe(eventsBefore);
  });
});
