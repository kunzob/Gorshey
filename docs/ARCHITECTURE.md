# Gorshey — Architecture Decisions

This records decisions already agreed. Change them only with Kunshe's approval, and log the change in `PROGRESS.md`.

## 0. Storage backend (swappable)

- **Now:** Supabase Storage, bucket `gorshey-media` (public bucket, read-only policy for `anon`). Free tier 1 GB —
  fits roughly the first 200 tracks at 128–160 kbps. No card required.
- **Later:** Cloudflare R2, bucket `gorshey-media` — free egress unconditionally, 10 GB free storage, then
  $0.015/GB-month. Requires a card + a Cloudflare budget alert (set to a low threshold, e.g. $1) at setup time.
- **Trigger to migrate:** approaching ~800 MB on Supabase, or needing >~200 tracks, whichever comes first.
- **What migration actually involves:** re-upload existing files to R2 (`tools/upload-r2.ts`, already written),
  change `cdnBase` in `tools/tracks.source.yaml`, run `npm run manifest`. No application code changes — every
  track's `src`/`artwork` field is a full URL (§8), so the player never knows or cares which backend served it.
- The upload script (`tools/upload-media.ts`) targets whichever backend is active via a `STORAGE_BACKEND` env var
  (`supabase` | `r2`); both code paths are written in M1, so flipping the switch later needs no new code.

## 1. Virtual synchronized broadcast
- `manifest.json` holds `epoch` (ISO-8601 UTC instant) and an ordered track list with **measured** float durations.
- `position = (clock.now() − epoch) mod totalDuration`; prefix sums + binary search map it to `{trackIdx, offsetSec}`.
- Durations are measured with `ffprobe` at build time, never typed by hand, so listeners don't drift.
- Accumulated error heals at every track boundary because `ended` re-resolves from the clock.

## 2. Clock correction
- Device clocks can be seconds off. On load, `clock.measureOffset()` sends 3 `HEAD` requests to our own origin
  (`cache: 'no-store'`), reads the `Date` header, corrects by RTT/2, and keeps the median offset.
- `Date` has 1 s resolution; that is acceptable for radio. Re-measure on `visibilitychange` if > 10 min since last.

## 3. Audio
- One persistent `<audio preload="none">` element. First play happens inside the user's tap (iOS unlock).
- States: `idle → loading → playing ⇄ buffering → paused`, plus `error`.
- Pause means "leave the live stream"; play again = rejoin live (re-sync), like a real radio.
- Media Session: title/artist/album/artwork; `seekto`, `previoustrack`, `nexttrack` explicitly disabled.

### 3a. AudioEngine state machine (M3)

`R` = `resolve(clock.now(), epochMs, starts)`. Every load starts with R. Nothing advances `idx+1`.

**States:** `idle`, `loading`, `playing`, `buffering`, `paused`, `error`.

| From → To | Trigger | Action | Calls R? |
| :--- | :--- | :--- | :--- |
| idle → loading | `play()` (user tap) | Set `src`; call `el.play()` at once (iOS unlock). Emit `track`. | yes |
| loading (metadata) | `loadedmetadata` | Re-resolve. If the track changed, reload; else set `currentTime = offsetSec`. | yes |
| loading → playing | `playing` | Start the 250 ms tick. Reset the reload count and retry. | no |
| playing → buffering | `waiting` / `stalled` | Emit `state`. Tick keeps running. | no |
| buffering → playing | `playing` | Emit `state`. | no |
| playing → loading | `ended` | Re-resolve. If the track changed, load it. If the clock still says the same track, wait until `endsAtMs` and re-check. | yes |
| playing → loading | tick sees a new track (boundary without `ended`) | Load the resolved track. | yes |
| playing → playing | `onVisible()`, track changed or drift > 2 s | Reload, or seek the same track. | yes |
| active → loading | first `error` | Stop tick. Wait 3 s, then re-resolve and reload. | yes (on retry) |
| → error | second `error`, or the reload cap is hit | Pause, drop all timers. Terminal until `play()`. | no |
| error → loading | `play()` | Reset the count, then re-sync. | yes |
| active → paused | `pause()` | `el.pause()`; invalidate the load token; clear all timers. | no |
| paused → loading | `play()` | Full re-sync. The stale position is never resumed. | yes |
| active → paused | `play()` rejected (e.g. `NotAllowedError`) | Invalidate the load; pause the element; tappable again. | no |

**Rules**
- **Reload cap:** `MAX_RELOADS = 3`. Reloads count from any trigger (metadata, tick, `onVisible`, `ended`, retry). The count resets when the element reaches `playing`. The next reload enters `error`.
- **Drift correction:** on each transition to `playing` (including a buffering recovery), if `|actual − expected| > 0.75 s`, seek to the clock-derived position. At most 3 corrections per play session; the 4th is skipped and recorded as a cap-hit. No correction runs while `loading` or `buffering`. Correction runs only at transitions to `playing`; it does not run on every tick.
- **Tick** runs in `playing` and `buffering`, so a boundary crossed during a stall is still caught.
- **Stale callbacks:** every load bumps a token. A late `loadedmetadata`, retry timer or play rejection is ignored once the user has paused or the load has been replaced.

**Public API (`src/audio/AudioEngine.ts`)**

```ts
type EngineState = 'idle' | 'loading' | 'playing' | 'buffering' | 'paused' | 'error';
interface TickEvent { trackIdx: number; positionSec: number }

class AudioEngine {
  constructor(manifest: Manifest, clock: Clock, el?: HTMLAudioElement) // el defaults to one new Audio()
  play(): void          // call from a click handler; idempotent while active
  pause(): void         // leaves live; idempotent when not active
  onVisible(): void     // re-sync on visibilitychange (no-op unless playing or buffering)
  readonly state: EngineState
  on('state', (s: EngineState) => void): Unsubscribe
  on('track', (idx: number) => void): Unsubscribe
  on('tick',  (t: TickEvent) => void): Unsubscribe   // every 250 ms while playing or buffering
  destroy(): void       // clears timers, removes element listeners, drops subscribers
}
```

## 4. Presence
- Channel `gorshey-kora`, per-tab UUID in `sessionStorage`.
- Subscribe on load (to show the count); `track()` on play, `untrack()` on pause → count = people actually listening.
- Badge copy: "N on the kora". On error or connection cap → "—". Never blocks playback.

## 5. i18n
- Locales now: `bo`, `en`. Later: `fr`, `zh-Hans`, others — adding one = one catalog file + metadata fields.
- UI strings: `src/i18n/catalogs/<locale>.json`, flat dotted keys.
- Track metadata: language maps `{ "bo": "…", "en": "…" }`; resolver falls back `current → en → bo`.
- Song title display: Tibetan original always primary; current-locale title as subtitle.
- Digits: always Western (`numberingSystem: 'latn'`). Time formatting uses `Intl`, falling back to `en` for `bo`.
- `<html lang>` is set on locale change so `:lang()` CSS applies automatically.

## 6. PWA caching

| Request | Strategy |
| :--- | :--- |
| App shell (hashed JS/CSS, fonts, icons, index.html) | Precache (injected list), cache-first |
| `/manifest.json` (tracklist) | Stale-while-revalidate |
| R2 domain (audio, artwork) | Not intercepted — browser + HTTP cache (`immutable`) handle it, range requests intact |
| Non-GET (incl. clock `HEAD`) | Not intercepted |

New SW versions show an "update available" notice; never auto-reload mid-song.

## 7. Theme — Potala Palace at night
- Tokens: night sky base `#0d0f14`, whitewash text, maroon-grey secondary, gold accent (active states only).
- Light-mode tokens (whitewash / maroon / gold) defined but not enabled.
- Signature element: **kora ring** — SVG progress ring around the artwork, filling **clockwise**.
- Copy: badge "N on the kora", eyebrow "ON AIR · MARPO RI",
  footer "MARPO RI · 3,700 M · EST. 1645 · STATION EST. FIRE HORSE 2153".
- Original SVG line drawing of the Potala as a faint mark. Grain via SVG `feTurbulence`. Respect `prefers-reduced-motion`.
- Station name: **Gorshey · སྒོར་གཞས།** (`short_name` "Gorshey").

## 8. Manifest schema (public/manifest.json)

```json
{
  "version": "2026-10-04T00:00:00Z",
  "epoch": "2026-01-01T00:00:00Z",
  "totalDuration": 1234.56,
  "tracks": [
    {
      "id": "a1b2c3",
      "title":  { "bo": "…", "en": "…" },
      "artist": { "bo": "…", "en": "…" },
      "duration": 214.37,
      "src": "https://cdn.example.com/audio/a1b2c3.m4a",
      "artwork": "https://cdn.example.com/art/a1b2c3.jpg"
    }
  ]
}
```

Changing the track list or order shifts everyone's position — that is expected and fine.

## 9. Hosting & headers
- Media objects (Supabase Storage now, R2 later): content-hashed filenames. On R2, set
  `Cache-Control: public, max-age=31536000, immutable` on upload. Supabase Storage sets its own cache headers on
  public objects; verify them in M1 and override via upload options if too short.
- Vercel: `index.html` and `sw.js` → `no-cache`; hashed assets → `immutable`; CSP allowing self, the active media
  domain (Supabase project domain now; add the R2 custom domain at migration time), and the Supabase project for
  presence (https + wss) — note the media domain and the presence domain are the *same* Supabase project today,
  which simplifies the CSP until R2 migration splits them.
