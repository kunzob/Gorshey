# M3 — Audio engine

**Goal:** a tested `AudioEngine` that plays the live position and stays in sync. Ugly test UI is fine.
**Skills:** `gorshey-audio-sync`, `test-driven-development` (if installed). **Checkpoint:** show the state diagram first.

## Files
`src/audio/AudioEngine.ts`, `src/audio/emitter.ts` (tiny typed emitter, shared), `tests/audioEngine.test.ts`,
temporary `src/ui/devHarness.ts` (play/pause button + text readout, removed in M5)

## API
```ts
class AudioEngine {
  constructor(manifest: Manifest, clock: Clock, el?: HTMLAudioElement)
  play(): void            // call from a click handler
  pause(): void
  onVisible(): void
  readonly state: EngineState
  on(event: 'state'|'track'|'tick', cb): Unsubscribe
  destroy(): void
}
```

## Steps
1. Write state-transition tests with a fake audio element (EventTarget with `currentTime`, `src`, `play()`, `pause()`).
   Cover: first play → loading → seek after metadata → playing; ended → re-resolve; pause → play re-syncs;
   visible with drift > 2 s re-syncs; stalled → buffering → playing; error → retry once → error.
2. Implement. `tick` uses `requestAnimationFrame`-free timing (`setInterval` 250 ms) and stops when not playing.
3. Wire `devHarness.ts` in `main.ts`; test on desktop with the M1 test tracks.

## Acceptance
- Two browser tabs started at different times play the same track within ~1 s.
- Leaving a tab paused for a minute then pressing play rejoins the live position.
- [HUMAN] Quick check on an iPhone over the local network (`vite --host`): first tap plays.
