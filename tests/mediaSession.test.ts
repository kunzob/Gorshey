import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AudioEngine, type EngineState } from '../src/audio/AudioEngine';
import { Emitter } from '../src/audio/emitter';
import {
  ALBUM,
  ARTWORK,
  initMediaSession,
  metadataFor,
  playbackStateFor,
  type MediaSessionEnv,
} from '../src/audio/mediaSession';
import type { Clock, Manifest, ManifestTrack } from '../src/core/types';
import enCatalog from '../src/i18n/catalogs/en.json';

// Fixtures mirror public/manifest.json (M1), as in tests/audioEngine.test.ts.
const EPOCH_MS = Date.parse('2026-01-01T00:00:00Z');
const SEC = 1000;
const TRACKS: ManifestTrack[] = [
  {
    id: 'bd4e9fd47041',
    title: { bo: 'མ་ནི་ཡིག་དྲུག', en: 'Song of Mani' },
    artist: { bo: 'མིང་མེད', en: 'Unknown' },
    duration: 211.255167,
    src: 'https://cdn.test/audio/bd4e9fd47041.mp3',
    artwork: 'https://cdn.test/art/per-track.jpg',
  },
  {
    id: '283d75d6d29d',
    title: { bo: 'རྟེན་འབྲེལ་དགའ་བསྲུ།', en: 'Auspicious Welcome' },
    artist: { bo: 'མིང་མེད', en: 'Unknown' },
    duration: 245.179521,
    src: 'https://cdn.test/audio/283d75d6d29d.mp3',
  },
];
const MANIFEST: Manifest = {
  version: '5166db301c24',
  epoch: '2026-01-01T00:00:00Z',
  epochMs: EPOCH_MS,
  totalDuration: 456.434688,
  tracks: TRACKS,
};

const NULLED = ['seekto', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack'] as const;

type Handler = ((details?: unknown) => void) | null;

/** Stand-in for navigator.mediaSession. Records every setActionHandler call in order. */
class FakeSession {
  metadata: unknown = null;
  playbackState: MediaSessionPlaybackState = 'none';
  calls: Array<[string, Handler]> = [];
  handlers = new Map<string, Handler>();
  throwFor = new Set<string>();

  setActionHandler(action: string, handler: Handler): void {
    if (this.throwFor.has(action)) throw new TypeError(`The provided value '${action}' is not a valid enum value`);
    this.calls.push([action, handler]);
    this.handlers.set(action, handler);
  }
}

/** Stand-in for the MediaMetadata constructor: keeps the init it was given. */
class FakeMetadata {
  constructor(readonly init: MediaMetadataInit) {}
}

/** Engine double with the four members mediaSession uses. */
class FakeEngine {
  state: EngineState = 'idle';
  playCalls = 0;
  pauseCalls = 0;
  private emitter = new Emitter<{ state: EngineState; track: number; tick: { trackIdx: number; positionSec: number } }>();
  on = this.emitter.on.bind(this.emitter);
  play(): void {
    this.playCalls++;
  }
  pause(): void {
    this.pauseCalls++;
  }
  emitState(s: EngineState): void {
    this.state = s;
    this.emitter.emit('state', s);
  }
  emitTrack(i: number): void {
    this.emitter.emit('track', i);
  }
}

function env(session: FakeSession | undefined = new FakeSession()): MediaSessionEnv {
  return {
    mediaSession: session as unknown as MediaSession | undefined,
    MediaMetadata: FakeMetadata as unknown as typeof MediaMetadata,
  };
}

function setup(locale: 'bo' | 'en' = 'en') {
  const session = new FakeSession();
  const engine = new FakeEngine();
  const loc = { current: locale as 'bo' | 'en' };
  const handle = initMediaSession(engine, () => loc.current, TRACKS, env(session));
  const meta = (): MediaMetadataInit | undefined => (session.metadata as FakeMetadata | null)?.init;
  return { session, engine, loc, handle, meta };
}

describe('mediaSession: action handlers', () => {
  it('registers exactly play and pause as functions', () => {
    const { session } = setup();
    const registered = [...session.handlers].filter(([, h]) => typeof h === 'function').map(([a]) => a);
    expect(registered.sort()).toEqual(['pause', 'play']);
  });

  it.each(NULLED)('sets %s to null explicitly', (action) => {
    const { session } = setup();
    expect(session.calls.some(([a, h]) => a === action && h === null)).toBe(true);
    expect(session.handlers.get(action)).toBeNull();
  });

  it.each(NULLED)('a browser that throws for %s still gets every other handler set', (action) => {
    const session = new FakeSession();
    session.throwFor.add(action);
    expect(() => initMediaSession(new FakeEngine(), () => 'en', TRACKS, env(session))).not.toThrow();
    const others = ['play', 'pause', ...NULLED.filter((a) => a !== action)];
    for (const a of others) expect(session.handlers.has(a)).toBe(true);
    expect(session.handlers.has(action)).toBe(false);
  });

  it('a browser that throws for play still sets pause and the nulled actions', () => {
    const session = new FakeSession();
    session.throwFor.add('play');
    expect(() => initMediaSession(new FakeEngine(), () => 'en', TRACKS, env(session))).not.toThrow();
    for (const a of ['pause', ...NULLED]) expect(session.handlers.has(a)).toBe(true);
  });

  it('the play handler calls engine.play() and nothing else', () => {
    const { session, engine } = setup();
    session.handlers.get('play')?.();
    expect(engine.playCalls).toBe(1);
    expect(engine.pauseCalls).toBe(0);
  });

  it('the pause handler calls engine.pause()', () => {
    const { session, engine } = setup();
    session.handlers.get('pause')?.();
    expect(engine.pauseCalls).toBe(1);
    expect(engine.playCalls).toBe(0);
  });
});

describe('mediaSession: playbackState mapping', () => {
  it('idle → none', () => expect(playbackStateFor('idle')).toBe('none'));
  it('loading → playing', () => expect(playbackStateFor('loading')).toBe('playing'));
  it('playing → playing', () => expect(playbackStateFor('playing')).toBe('playing'));
  it('buffering → playing', () => expect(playbackStateFor('buffering')).toBe('playing'));
  it('paused → paused', () => expect(playbackStateFor('paused')).toBe('paused'));
  it('error → paused', () => expect(playbackStateFor('error')).toBe('paused'));

  it.each<[EngineState, MediaSessionPlaybackState]>([
    ['loading', 'playing'],
    ['playing', 'playing'],
    ['buffering', 'playing'],
    ['paused', 'paused'],
    ['error', 'paused'],
    ['idle', 'none'],
  ])('engine state event %s sets navigator.mediaSession.playbackState to %s', (state, expected) => {
    const { session, engine } = setup();
    engine.emitState(state === 'idle' ? 'paused' : 'idle'); // start from a different value
    engine.emitState(state);
    expect(session.playbackState).toBe(expected);
  });

  it('applies the engine state at init, before any event', () => {
    const session = new FakeSession();
    const engine = new FakeEngine();
    engine.state = 'paused';
    initMediaSession(engine, () => 'en', TRACKS, env(session));
    expect(session.playbackState).toBe('paused');
  });
});

describe('mediaSession: metadata', () => {
  it('album is "Gorshey · སྒོར་གཞས།", the station name', () => {
    expect(ALBUM).toBe('Gorshey · སྒོར་གཞས།');
    expect(ALBUM).toBe(enCatalog['station.name']);
  });

  it('artwork is the station art at 192 and 512, JPEG, same origin', () => {
    expect(ARTWORK).toEqual([
      { src: '/artwork/artwork-192.jpg', sizes: '192x192', type: 'image/jpeg' },
      { src: '/artwork/artwork-512.jpg', sizes: '512x512', type: 'image/jpeg' },
    ]);
  });

  it('metadataFor builds the en title and artist through pick, ignoring per-track artwork', () => {
    expect(metadataFor(TRACKS[0]!, 'en')).toEqual({
      title: 'Song of Mani',
      artist: 'Unknown',
      album: ALBUM,
      artwork: ARTWORK,
    });
  });

  it('metadataFor builds the bo title and artist', () => {
    const m = metadataFor(TRACKS[1]!, 'bo');
    expect(m.title).toBe('རྟེན་འབྲེལ་དགའ་བསྲུ།');
    expect(m.artist).toBe('མིང་མེད');
  });

  it('metadataFor returns a fresh artwork array (the shared constant cannot be mutated through it)', () => {
    const m = metadataFor(TRACKS[0]!, 'en');
    expect(m.artwork).not.toBe(ARTWORK);
  });

  it('no metadata is set before the first track event', () => {
    const { session } = setup();
    expect(session.metadata).toBeNull();
  });

  it('sets metadata on every track event', () => {
    const { engine, meta } = setup();
    engine.emitTrack(0);
    expect(meta()?.title).toBe('Song of Mani');
    engine.emitTrack(1);
    expect(meta()?.title).toBe('Auspicious Welcome');
    expect(meta()?.album).toBe(ALBUM);
  });

  it('ignores a track index outside the playlist', () => {
    const { engine, session } = setup();
    engine.emitTrack(7);
    expect(session.metadata).toBeNull();
  });
});

describe('mediaSession: locale switch updates the title immediately', () => {
  it('refresh() after a locale change rewrites the title on the same track, without a track event', () => {
    const { engine, loc, handle, meta } = setup('en');
    engine.emitTrack(1);
    expect(meta()?.title).toBe('Auspicious Welcome');
    loc.current = 'bo';
    handle.refresh();
    expect(meta()?.title).toBe('རྟེན་འབྲེལ་དགའ་བསྲུ།');
    expect(meta()?.artist).toBe('མིང་མེད');
  });

  it('refresh() before any track does nothing', () => {
    const { session, handle } = setup();
    handle.refresh();
    expect(session.metadata).toBeNull();
  });
});

describe('mediaSession: missing API', () => {
  it('no navigator.mediaSession: returns a handle, throws nothing, and refresh/dispose are safe', () => {
    const engine = new FakeEngine();
    const handle = initMediaSession(engine, () => 'en', TRACKS, env(undefined));
    expect(() => {
      engine.emitState('playing');
      engine.emitTrack(0);
      handle.refresh();
      handle.dispose();
    }).not.toThrow();
  });

  it('no MediaMetadata constructor: handlers and state still apply, metadata is skipped', () => {
    const session = new FakeSession();
    const engine = new FakeEngine();
    const noMeta: MediaSessionEnv = { mediaSession: session as unknown as MediaSession, MediaMetadata: undefined };
    const handle = initMediaSession(engine, () => 'en', TRACKS, noMeta);
    engine.emitTrack(0);
    engine.emitState('playing');
    handle.refresh();
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('playing');
    expect(typeof session.handlers.get('play')).toBe('function');
  });

  it('the default env with no mediaSession in navigator throws nothing (Node has none)', () => {
    expect('mediaSession' in (globalThis.navigator ?? {})).toBe(false);
    expect(() => initMediaSession(new FakeEngine(), () => 'en', TRACKS).dispose()).not.toThrow();
  });
});

describe('mediaSession: dispose', () => {
  it('nulls every handler, clears metadata, sets none, and stops listening', () => {
    const { session, engine, handle } = setup();
    engine.emitTrack(0);
    engine.emitState('playing');
    handle.dispose();
    for (const a of ['play', 'pause', ...NULLED]) expect(session.handlers.get(a)).toBeNull();
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');
    engine.emitState('playing');
    engine.emitTrack(1);
    expect(session.playbackState).toBe('none');
    expect(session.metadata).toBeNull();
  });
});

describe('mediaSession: module boundary', () => {
  it('src/audio/mediaSession.ts never mentions document or window', () => {
    const src = readFileSync(new URL('../src/audio/mediaSession.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bdocument\b/);
    expect(src).not.toMatch(/\bwindow\b/);
  });
});

// ---- integration with the real AudioEngine -------------------------------

/** Minimal HTMLAudioElement stand-in (same contract as the one in tests/audioEngine.test.ts). */
class FakeAudio extends EventTarget {
  preload = '';
  src = '';
  currentTime = 0;
  duration = NaN;
  playImpl: () => Promise<void> = () => Promise.resolve();
  play(): Promise<void> {
    return this.playImpl();
  }
  pause(): void {}
  loadMetadata(): void {
    this.dispatchEvent(new Event('loadedmetadata'));
  }
  fire(name: string): void {
    this.dispatchEvent(new Event(name));
  }
}

function realSetup(startMs: number) {
  const el = new FakeAudio();
  const clock = { t: startMs, now: () => clock.t };
  const engine = new AudioEngine(MANIFEST, clock as Clock, el as unknown as HTMLAudioElement);
  const session = new FakeSession();
  initMediaSession(engine, () => 'en', TRACKS, env(session));
  const lockScreenPlay = (): void => session.handlers.get('play')?.();
  const lockScreenPause = (): void => session.handlers.get('pause')?.();
  return { el, clock, engine, session, lockScreenPlay, lockScreenPause };
}

describe('mediaSession + AudioEngine: a lock-screen play always resolves from the clock', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('loads the clock-resolved track (track 1 at epoch + 300 s) and sets its metadata', () => {
    const h = realSetup(EPOCH_MS + 300 * SEC);
    h.lockScreenPlay();
    expect(h.el.src).toBe(TRACKS[1]!.src);
    expect((h.session.metadata as FakeMetadata).init.title).toBe('Auspicious Welcome');
    expect(h.session.playbackState).toBe('playing'); // loading
  });

  it('re-resolves after loadedmetadata: time that passed while loading is applied to the seek', () => {
    const h = realSetup(EPOCH_MS + 50 * SEC);
    h.lockScreenPlay();
    h.clock.t += 10 * SEC;
    h.el.loadMetadata();
    expect(h.el.currentTime).toBeCloseTo(60, 6);
  });

  it('pause then lock-screen play rejoins live, not the old position', () => {
    const h = realSetup(EPOCH_MS + 50 * SEC);
    h.lockScreenPlay();
    h.el.loadMetadata();
    h.el.fire('playing');
    h.lockScreenPause();
    expect(h.session.playbackState).toBe('paused');
    h.clock.t += 200 * SEC; // now 250 s: inside track 1
    h.lockScreenPlay();
    expect(h.el.src).toBe(TRACKS[1]!.src);
    h.el.loadMetadata();
    expect(h.el.currentTime).toBeCloseTo(250 - 211.255167, 3);
    expect((h.session.metadata as FakeMetadata).init.title).toBe('Auspicious Welcome');
  });

  it('autoplay rejection goes through the engine: state paused, playbackState paused', async () => {
    const h = realSetup(EPOCH_MS + 50 * SEC);
    h.el.playImpl = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    h.lockScreenPlay();
    await vi.runAllTimersAsync();
    expect(h.engine.state).toBe('paused');
    expect(h.session.playbackState).toBe('paused');
  });
});
