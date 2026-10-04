# M2 — Sync core

**Goal:** pure, fully tested time and schedule logic.
**Skills:** `gorshey-audio-sync`, `test-driven-development` (if installed).

## Files
`src/core/clock.ts`, `src/core/schedule.ts`, `src/core/types.ts`, `src/core/manifest.ts`,
`tests/schedule.test.ts`, `tests/clock.test.ts`, `tests/manifest.test.ts`

## Functions
- `schedule.ts`: `buildIndex`, `resolve` — as in the skill §1.
- `clock.ts`: `measureOffset(samples?, fetchFn?)`, `now()`, `setOffset()` (test hook). Inject `fetchFn` for tests.
- `manifest.ts`: `loadManifest(url): Promise<Manifest>` with runtime validation (shape, positive durations,
  `totalDuration` equals the sum within 1 ms); `pick(map, locale)` belongs to i18n, not here.

## Steps
1. Write the full test list from the skill first; watch them fail.
2. Implement until green. No DOM, no timers in `core/`.
3. Clock tests: mocked responses with known `Date` headers and delays; median selection; failure → offset 0.

## Acceptance
- 100% branch coverage on `schedule.ts`; all listed edge cases covered.
- `npm run lint` confirms no `Date.now` outside `clock.ts`.
