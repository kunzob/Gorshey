import type { AudioEngine, EngineState } from './AudioEngine';
import type { Unsubscribe } from './emitter';
import type { ManifestTrack } from '../core/types';
import { pick } from '../i18n/i18n';
import type { Locale } from '../i18n/locales';

/** The station name, shown as the album on the lock screen. Same string as `station.name`. */
export const ALBUM = 'Gorshey · སྒོར་གཞས།';

/** Station artwork (public/artwork, made by tools/make-artwork.mjs). Per-track artwork is not used here. */
export const ARTWORK: readonly MediaImage[] = [
  { src: '/artwork/artwork-192.jpg', sizes: '192x192', type: 'image/jpeg' },
  { src: '/artwork/artwork-512.jpg', sizes: '512x512', type: 'image/jpeg' },
];

// Live radio: no scrubbing and no skipping. Each is set to null explicitly so the OS hides the control.
const NULLED: readonly MediaSessionAction[] = ['seekto', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack'];

/** What the module needs from the browser. Injected in tests; defaults to the real globals. */
export interface MediaSessionEnv {
  mediaSession: MediaSession | undefined;
  MediaMetadata: typeof MediaMetadata | undefined;
}

export interface MediaSessionHandle {
  /** Rebuilds the metadata for the current track in the current locale (call on locale change). */
  refresh(): void;
  /** Nulls every handler, clears metadata and stops listening to the engine. */
  dispose(): void;
}

type SessionEngine = Pick<AudioEngine, 'state' | 'on' | 'play' | 'pause'>;

/**
 * loading and buffering count as playing: the listener asked for audio, so the lock screen offers Pause.
 * error maps to paused so the lock screen offers Play, which retries through engine.play().
 */
export function playbackStateFor(state: EngineState): MediaSessionPlaybackState {
  switch (state) {
    case 'idle':
      return 'none';
    case 'loading':
    case 'playing':
    case 'buffering':
      return 'playing';
    case 'paused':
    case 'error':
      return 'paused';
  }
}

export function metadataFor(track: ManifestTrack, locale: Locale): MediaMetadataInit {
  return {
    title: pick(track.title, locale),
    artist: pick(track.artist, locale),
    album: ALBUM,
    artwork: ARTWORK.map((img) => ({ ...img })),
  };
}

function defaultEnv(): MediaSessionEnv {
  const nav = globalThis.navigator as Navigator | undefined;
  return {
    mediaSession: nav && 'mediaSession' in nav ? nav.mediaSession : undefined,
    MediaMetadata: typeof MediaMetadata === 'function' ? MediaMetadata : undefined,
  };
}

/** Some browsers throw for actions they do not know; one failure must not stop the others. */
function setHandler(session: MediaSession, action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
  try {
    session.setActionHandler(action, handler);
  } catch {
    // unsupported action in this browser: nothing to hide or wire
  }
}

/**
 * Lock-screen and notification controls. Play and pause go through the engine's normal path,
 * so every play re-resolves the position from the clock. Does nothing where the API is missing.
 */
export function initMediaSession(
  engine: SessionEngine,
  getLocale: () => Locale,
  tracks: readonly ManifestTrack[],
  env: MediaSessionEnv = defaultEnv(),
): MediaSessionHandle {
  const session = env.mediaSession;
  if (!session) return { refresh() {}, dispose() {} };
  const Metadata = env.MediaMetadata;
  let currentIdx = -1;

  const applyMetadata = (): void => {
    const track = tracks[currentIdx];
    if (!track || !Metadata) return;
    session.metadata = new Metadata(metadataFor(track, getLocale()));
  };
  const applyState = (state: EngineState): void => {
    session.playbackState = playbackStateFor(state);
  };

  setHandler(session, 'play', () => engine.play());
  setHandler(session, 'pause', () => engine.pause());
  for (const action of NULLED) setHandler(session, action, null);

  applyState(engine.state);
  const offs: Unsubscribe[] = [
    engine.on('state', applyState),
    engine.on('track', (idx) => {
      currentIdx = idx;
      applyMetadata();
    }),
  ];

  return {
    refresh: applyMetadata,
    dispose() {
      offs.forEach((off) => off());
      setHandler(session, 'play', null);
      setHandler(session, 'pause', null);
      for (const action of NULLED) setHandler(session, action, null);
      session.metadata = null;
      session.playbackState = 'none';
    },
  };
}
