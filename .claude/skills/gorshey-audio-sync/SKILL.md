---
name: gorshey-audio-sync
description: Synchronized-playback rules for the Gorshey virtual radio — epoch/schedule math, clock-offset correction, the AudioEngine state machine, iOS Safari audio behavior, Media Session, and service-worker routing for audio. Use this skill whenever you write or change anything in src/core/, src/audio/, src/sw.ts, or code that plays, pauses, seeks, advances tracks, measures time, or caches requests — even for a "small fix", because sync bugs are subtle and only show up across devices.
---

# Gorshey — audio & sync

The radio has no server stream. Every client computes "what is playing now and at what second" from
the same epoch and playlist. Correctness therefore depends on three things: an accurate clock, exact
durations, and always re-deriving position from the clock instead of trusting local playback history.

## 1. Schedule math (src/core/schedule.ts — pure, unit-tested)

```ts
export interface Track { id: string; duration: number; /* …metadata */ }
export interface Position { trackIdx: number; offsetSec: number; endsAtMs: number }

export function buildIndex(tracks: Track[]): number[] {
  // starts[i] = seconds from loop start to the start of track i; last entry = total
  const starts = [0];
  for (const t of tracks) starts.push(starts[starts.length - 1] + t.duration);
  return starts;
}

export function resolve(nowMs: number, epochMs: number, starts: number[]): Position {
  const total = starts[starts.length - 1];
  const elapsed = (nowMs - epochMs) / 1000;
  const loopPos = ((elapsed % total) + total) % total;          // handles now < epoch
  let lo = 0, hi = starts.length - 2;                            // binary search: last start <= loopPos
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= loopPos) lo = mid; else hi = mid - 1; }
  const offsetSec = loopPos - starts[lo];
  const endsAtMs = nowMs + (starts[lo + 1] - loopPos) * 1000;
  return { trackIdx: lo, offsetSec, endsAtMs };
}
```

Required tests: before epoch, exactly at epoch, exactly on a track boundary (offset 0 of next track),
last track → wraps to track 0, many loops later (large `now`), single-track playlist, float durations.

## 2. Clock (src/core/clock.ts)
- `measureOffset(samples = 3)`: for each sample, `t0 = Date.now()`, `HEAD /` with `cache: 'no-store'`,
  `t1 = Date.now()`, `server = Date.parse(res.headers.get('date'))`, `offset = server + 500 − (t0 + t1) / 2`.
  The `+500` centers the 1-second truncation of the `Date` header. Return the median; on failure return 0.
- `now()` = `Date.now() + offset`. This is the only place `Date.now()` is read.
- Re-measure when the page becomes visible after > 10 minutes hidden.

## 3. AudioEngine (src/audio/AudioEngine.ts)
State machine: `idle → loading → playing ⇄ buffering → paused`, any → `error`.
Emit `state`, `track` (index), `tick` (≈4 Hz while playing). Never touch the DOM except the one audio element it owns.

Rules, each with the reason:
- **One element, created once** (`new Audio()` or the `<audio>` in index.html). iOS unlocks playback per element
  on a user gesture; a second element would be blocked.
- **`play()` must call `audio.play()` synchronously inside the tap handler chain** for the first play. Set `src`,
  call `audio.play()` immediately (it returns a promise), then seek once metadata arrives.
- **Seek after `loadedmetadata`**, then **re-resolve** before seeking — time passed while loading.
- **On `ended`**: resolve from the clock and load that track. Do not do `idx + 1`; this self-heals drift.
  If resolve still returns the track that just ended (clock lag), schedule a re-resolve at `endsAtMs`.
- **On visible again** (`visibilitychange`): if `|expected − audio.currentTime| > 2 s`, or the track changed, re-sync.
- **Pause = leave live.** The next play re-syncs; never resume a stale position.
- `waiting` / `stalled` → `buffering`; `playing` → back to `playing`; on `error` retry once after 3 s, then `error` state.
- Small seek drift (< 2 s) is tolerated while playing — seeking causes audible glitches.

## 4. Media Session (src/audio/mediaSession.ts)
- Set `navigator.mediaSession.metadata` on every track change: title (current locale, fall back to bo),
  artist, album `"Gorshey · སྒོར་གཞས།"`, artwork in 96/256/512 sizes when available.
- Handlers: `play`, `pause` → engine. Set `seekto`, `seekbackward`, `seekforward`, `previoustrack`, `nexttrack` to `null`.
- Guard everything with `'mediaSession' in navigator`.

## 5. Service worker (src/sw.ts)
- Only handle `GET` requests to our own origin. Return early (no `respondWith`) for: non-GET, any other origin
  (R2 audio/artwork, Supabase), and requests with a `Range` header.
- Reason: Safari seeks with `Range` requests and needs real `206` responses; a SW answering with a cached full
  `200` breaks seeking, and seeking is how sync works.
- Precache the injected shell list; `/manifest.json` uses stale-while-revalidate; old caches deleted on `activate`.
- No `skipWaiting()` on install; the page shows an update notice and the user chooses when to reload.

## 6. iOS / Safari checklist (verify in M10)
- First tap plays on iOS Safari browser and installed PWA.
- Lock screen shows Gorshey metadata and artwork; play/pause work; no scrub bar actions.
- Background ~5 min, return: position re-syncs to within ~1–2 s of another device.
- Track boundary passes cleanly with the screen locked (audio continues to next track).
- Airplane mode on a cached PWA: shell loads; playback shows a clear offline state instead of hanging.

See `references/pitfalls.md` for failure modes found in testing (agent appends to it).
