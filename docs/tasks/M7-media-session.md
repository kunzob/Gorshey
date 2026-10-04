# M7 — Media Session

**Goal:** lock-screen and notification controls with Gorshey metadata.
**Skills:** `gorshey-audio-sync` §4.

## Files
`src/audio/mediaSession.ts`, `tests/mediaSession.test.ts`

## Functions
- `initMediaSession(engine, getLocale)` — registers play/pause; nulls seek/prev/next handlers.
- `updateMetadata(track, locale)` — title via `pick`, artist, album "Gorshey · སྒོར་གཞས།", artwork sizes.
- Update `playbackState` on engine state changes.

## Acceptance
- [HUMAN] iPhone lock screen and Android notification show title/artwork; play/pause work; no scrubbing.
- Locale switch updates the lock-screen title on the next track or immediately (either is fine — document which).
