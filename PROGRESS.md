# Gorshey — Progress Log

The agent updates this file at the end of every task. Newest notes at the bottom of each section.

## Milestones
- [ ] M00 Human setup (accounts, tools) — Kunshe
- [x] M0  Project scaffold
- [x] M1  Content pipeline (manifest + R2 upload script)
- [x] M2  Sync core (clock + schedule)
- [x] M3  Audio engine
- [x] M4  i18n (bo / en)
- [x] M5b Visual design pass (Lantern Column): evidence 78c96f9, 35f1624
- [x] M5  UI shell (Potala theme, kora ring): accepted by Kunshe (evidence: 6a5fc03, 592a017, 3d66029, e104ba0, 1be9975; [HUMAN] checks confirmed)
- [ ] M6  Presence (Supabase): code complete (20053de); live checks below still pending, so not ticked
- [ ] M7  Media Session
- [ ] M8  PWA (manifest + service worker)
- [ ] M9  Theme polish
- [ ] M10 QA (devices, Tibetan rendering, security review)
- [ ] M11 Deploy

## Decisions made during the build
- Storage backend: start on **Supabase Storage** (free, no card, ~200-track ceiling), migrate to **Cloudflare R2**
  later when approaching that ceiling. Manifest stores full URLs so the swap is config-only. See ARCHITECTURE §0.

- M0 scaffold: hand-written config instead of create-vite (no template files to delete). Installed exactly the approved
  dependency list; resolved to vite 8, vitest 5, typescript 6, eslint 10, typescript-eslint 8, @supabase/realtime-js 2.
- ESLint excludes `.claude/**` (kit scripts are not app code). `document` is banned outside src/ui/ and `Date.now` outside
  src/core/clock.ts; both verified by a temporary probe file in src/core/.
- npm warned that esbuild has a pending postinstall script (`npm approve-scripts`). Build passes without it; left unapproved.

- M1 content pipeline: `@supabase/supabase-js` (dev, tools only) and `@types/node` (dev) approved by Kunshe.
  Runtime deps unchanged. Storage modules take an injected `readFile`, so they never import Node built-ins.
- R2 backend: plain fetch request building with tests. The signing step is `signAndSend()`, which throws
  "not implemented" until migration. Tests use a no-op signer seam, not real signing.
- Manifest CLI is `tools/run-manifest.ts`. `tools/build-manifest.ts` stays pure. `npm run manifest` runs the CLI, then check-tibetan.
- Manifest `version` is a 12-hex content hash, not an ISO timestamp. Reason: the repo bans `new Date()` outside clock.ts.
  ARCHITECTURE §8 shows an ISO example. Needs Kunshe's OK.
- Credential files expected by `npm run upload` (names only): `tools/.supabase-service-key.env` with
  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; `tools/.r2-credentials.env` with R2_ENDPOINT.
- e2e test needs ffmpeg and ffprobe on PATH.
- M1 done: two real tracks uploaded to Supabase; `public/manifest.json` committed (version `5166db301c24`,
  totalDuration 456.434688 s = 211.255167 + 245.179521).
- Supabase `exists()` now lists the folder instead of HEAD. Supabase returns a bodyless 400 on HEAD for missing
  objects, so HEAD cannot tell "missing" from "error".
- `SUPABASE_URL` is validated before use.
- Artist names are placeholders ("Unknown" / མིང་མེད). Tibetan titles still need a native-speaker review.

- M2 sync core: `src/core/` has `schedule.ts` (buildIndex, resolve), `clock.ts` (measureOffset, now, setOffset,
  shouldRemeasure), `manifest.ts` (`parseManifest`, pure, validates `unknown`), `types.ts`. `src/net/loadManifest.ts`
  is the only fetch of the manifest (wiring layer, not core). Tests use hardcoded M1 durations (211.255167,
  245.179521, total 456.434688), not a read of public/manifest.json.
- M2 choices: `measureOffset` drops failed samples and takes the median of the rest; it returns 0 only when all fail.
  `buildIndex` throws on an empty playlist. `parseManifest` also returns `epochMs`. Track `artwork` is optional.
  `parseManifest` rejects duplicate track ids (the second occurrence is named in the error).
- `isSynced()` is false until a sample succeeds. When every sample fails, `measureOffset` returns 0 and `isSynced()`
  stays false, so callers can tell "measured 0" from "not measured". `resetClock()` is a test hook.
- Coverage: `@vitest/coverage-v8` 5.0.3 (matches vitest 5, dev only), `npm run test:coverage`. Threshold is 100%
  branches on `src/core/**` only. `coverage/` is gitignored.
- Lint and build now type-check with `noUncheckedIndexedAccess`; index access in core uses `as number` with a comment.

- M3 audio engine (accepted by Kunshe): `src/audio/AudioEngine.ts`,
  `src/audio/emitter.ts`, `src/ui/devHarness.ts` (temporary, removed in M5), `src/main.ts` wiring. The state machine and
  API are in ARCHITECTURE §3a. 30 engine tests in `tests/audioEngine.test.ts`.
- M3 decisions: the reload cap is 3 (`MAX_RELOADS`), and the count resets on `playing`. The tick runs in `playing` and
  `buffering`. A play() rejection pauses the element and returns to `paused`. Boundary timers re-check the clock and never
  reload the ended track.
- M3 float finding: `211.255167 s` in ms resolves to `211.2551669921875`, just under the boundary. The clock-lag path
  covers this with a timer of about 0 ms, so a boundary that is a few microseconds away is not a bug.
- M3 drift correction (added after the first manual test: the late joiner landed seconds off): on each transition to
  `playing`, seek when |drift| > 0.75 s; max 3 per play session, then cap-hit recorded. The dev harness shows a 1 s debug
  readout (expected vs actual, drift, el.duration vs manifest, corrections). Known gap: no correction runs during smooth
  playback between transitions.
- Sync refinement (after the two-tab failures, which the readout showed are not explained by HTTP caching: the Date header
  matched local time within 1 s in both windows): the coarse offset stays as before. `refineOffset()` then polls HEAD every
  100 ms (cache-busted, no-store), up to 25 requests / 3 s, and brackets each server-second tick. Offset = server boundary
  − local boundary estimate, median over brackets. No tick means the coarse offset is kept, and `syncPrecision()` says so.
  The engine re-syncs once through resolve() when a refinement moves the position by more than 0.3 s. Drift threshold is 0.3 s
  once refined, 0.75 s while coarse. Two-window desktop retest **passed** after the CBR re-encode and this refinement
  (reported by Kunshe).
- Still open for M3: the iPhone check below, and the clock re-check on the deployed Vercel site (see follow-ups).
- [HUMAN] iPhone check (Kunshe): run `npm run dev -- --host` on the local network and confirm the first tap plays on
  iOS Safari.

## Open questions / follow-ups
- [HUMAN] Re-check clock precision on the deployed Vercel site. Date and Age headers may behave differently behind the CDN,
  so `syncPrecision()` must be confirmed to reach `refined` there.
- Add a normalise-to-CBR step to the upload pipeline. VBR mp3 without a seek table caused inaccurate seeking in testing.
- [native-speaker review] **Needs native review (all 9 `bo` strings in src/i18n/catalogs/bo.json, drafted by the agent):**
  station.name, player.play, player.pause, player.live, badge.listeners, player.nowPlaying, player.nextUp, player.error,
  player.offline. Listed by `npm run i18n:review`. Also the Tibetan track titles (kept verbatim from Kunshe).
  The M11 checklist requires `i18n:review` to report zero.
- Confirm the manifest version format (content hash vs ISO timestamp in ARCHITECTURE §8).
- ARCHITECTURE §0 says `tools/upload-r2.ts` is "already written" and names `tools/upload-media.ts`. The file that exists is `upload-media.ts`; no upload-r2 file exists. Fix the doc.
- Confirm the credential variable names above before Kunshe creates the files.
- Licensing of tracks: deferred by Kunshe; manifest stays source-agnostic.
- npm allow-scripts: decide whether to approve esbuild's postinstall (build works without it).
- Native-speaker review of Tibetan UI strings before launch.

## M5 notes
- Built: `src/ui/render.ts` (only DOM writer; textContent and lang spans), `view.ts` (pure view logic), `KoraRing.ts`,
  `ClockView.ts`, `LocaleToggle.ts`, `visibility.ts`, `dom.ts`. `devHarness.ts` and `tibetan.css` removed (merged into
  `base.css` and `fonts.css`). `main.ts` disposes the engine on hot reload.
- Tests: `tests/ui-shell.test.ts` covers the view logic, CSS and HTML rules, the font's hash and coverage, and a static
  check that src/ui never uses innerHTML. Still missing: DOM-behaviour tests for render.ts (needs happy-dom or jsdom).
- Font: Noto Serif Tibetan (SIL OFL 1.1) instead of Jomolhari, because the official Google Fonts source delivers a
  WOFF2 Tibetan subset and Jomolhari has no official WOFF2 source. Source and hashes: `public/fonts/SOURCE.md`.
  Coverage: every assigned code point in U+0F00-0FFF (test). No conversion or subsetting by us.
- Eyebrow template uses the Tibetan shad (།) as separator in bo, because check-tibetan requires Tibetan in every bo value.
- Size-adjust values (100% Tibetan, 125% fallback) are starting points; tune in M10.

## Open for M5
- [HUMAN] Visual check at phone width in Chrome: layout, the kora ring, and the touch targets. (Round 4 measured
  375x667 in both languages in headless Chrome; the human recheck is still required.)
- [HUMAN] Tibetan rendering check: no clipped or overlapping stacks in the title, subtitle or brand mark.
- [HUMAN] CLS check when the Tibetan web font swaps in (Performance panel, CLS about 0).
- DOM tests: `tests/render.test.ts` uses happy-dom 20.14.5 (pinned, devDependency, per-file docblock). 17 tests pass.
  Mutation check: a forced lang/innerHTML change fails 4 tests; a status change fails 2.
- **M8 (added to docs/tasks/M8-pwa.md):** precache the Tibetan font in the service worker:
  `/fonts/NotoSerifTibetan-tibetan-subset.woff2` and `/fonts/OFL.txt`.
- Native review: 14 bo strings are unreviewed (`npm run i18n:review`).

## M5 visual fixes (round 2)
- Fixed: play button centred; next-up runs separated by the catalog separator (`list.separator`, text not a span); the
  language toggle label carries lang="bo" and gets the Tibetan scale; Latin-first `:lang(bo)` stack (no serif before
  the Latin sans); one Tibetan scale through `size-adjust: 120%` on both Tibetan faces (per the skill: size via
  size-adjust, not font-size); `.player` is `min-height: 100dvh` with border-box padding; the ring is sized from height as well as width.
- Position under the artist: the empty paused state no longer shows text. It was the drafted Tibetan "ཚོད་མེད།",
  which read as an extra line. Now empty, so nothing shows there when paused.
- DEFERRED to M9 (theme polish): artwork inside the ring. `render.ts` does not set the `<img id="artwork">` source yet.
  The manifest URL returns `200 image/jpeg`, so it will load once wired. Requirement for M9: a missing or failing image
  must fall back gracefully. The ring stays, the image is hidden on error (no broken-image icon), and the layout does
  not shift.
- Round 3 (toggle label): the label is now a `<span lang="bo">` inside the button, which keeps the UI language. The Tibetan
  scale is 125% (size-adjust) for all Tibetan text. Headless Chrome screenshot at a true 390 px width (an iframe) shows
  the Tibetan label at the title's scale. The 48 px target is unchanged.
- Position line: empty while paused. It shows "m:ss / m:ss" while playing (DOM test). A headless screenshot cannot
  reach the playing state (no autoplay, no network audio), so this is verified by test only.
- The earlier extra Tibetan line under the artist was the paused-state placeholder "ཚོད་མེད།" ("no time"), which the
  Tibetan check had forced into the catalog. Removed.
- [HUMAN] Re-check at phone width in Chrome: the page fits one viewport in both languages (no scroll), and the play
  button and next-up line are visible without scrolling. Layout is not measured in tests.

## M10 checklist additions
- [ ] Lighthouse CLS check on the production build (mobile emulation), with the Tibetan web font swapping in. Target: CLS ≈ 0.
- [ ] Layout at 375x667 in both languages: no page scroll, play button and next-up line fully visible (round 4 check).

## M5b visual design (Direction B, Lantern Column)
- Built: full-bleed hero (`public/hero/hero-potala.svg`, 4,420 bytes, one `<img>` slot, no runtime filter), a scrim, a
  pre-rendered grain tile (`public/grain/grain.png`, 4,228 bytes, from `tools/make-grain.mjs`), the kora halo with the
  artwork inside, a glass strip (eyebrow, title, subtitle, artist, position, pill play button), next-up line, mono footer.
- Artwork in the ring: the M5 deferral is superseded by the approved composition. A missing or failing image is hidden,
  so the ring stays and no broken-image icon shows (tests).
- Footer: `footer.line` from the catalogs only ("MARPO RI · 3,700 M · 1645"). The "EST." copy and the mantra are not in
  production. The footer source is ARCHITECTURE §7 (original copy: "MARPO RI · 3,700 M · EST. 1645 · STATION EST. FIRE HORSE 2153").
  **Unverified** until Kunshe confirms the figures and the wording.
- Contrast (headless Chrome, production build, text made transparent, brightest background pixel under each box, WCAG 2.x,
  opacity blended in worst case). 375x667 and 1280x800, en and bo: every text block passes. Lowest: artist 8.34:1 (4.5 needed);
  play 12.57:1; footer 9.43:1; position (proxy, strip background, while playing) 8.58:1. No scrim change needed.
  Scratch script: `scratch/m5b/contrast.mjs` (not committed). Playing state is not reachable headlessly, so position is a proxy.
- Layout at 375x667: lowest element ends at 597 px (en) and 614 px (bo). Play button 48 px high, one line (nowrap).
- Mockups: `scratch/m5b/` (ignored by git, see `chore: ignore scratch/`).

## Native-review list (added in M5b)
- Footer line (bo): `footer.line`. Also the eyebrow, badge, and other new bo strings (`npm run i18n:review` lists them all).
- Mantra: the placement of the mantra is not in production. Neutral placeholder only. The reviewer needs to decide whether
  it belongs, and where, before any use.

## M5 / M5b evidence (ticked by Kunshe's request)
- M5b commits: 78c96f9 (feat: Lantern Column), 35f1624 (docs). Scratch mockups: `scratch/m5b/` (git-ignored, 81bb684).
- Red runs captured before implementation: static 8 failures, DOM 5 failures (see the session log).
- Contrast, 375x667 and 1280x800, en and bo, scrim NOT added (all pass):
  whitewash text rgb(242,237,228) on the brightest background pixel under each box:
  station 16.44:1 (large, needs 3); locale 16.44; title 16.54; subtitle 16.54; play 12.57; nextup 13.34;
  badge/clock/eyebrow/footer 9.43 (opacity 0.75); artist 8.34 (opacity 0.7); position (proxy, strip background,
  while playing) 8.58 (opacity 0.8). Needs: 4.5:1 body, 3:1 large. Script: `scratch/m5b/contrast.mjs`.
- Greps: innerHTML/outerHTML/insertAdjacentHTML in src: none. Date.now/new Date in src: only src/core/clock.ts.
  document in src outside src/ui: none.
- Known hard-coded items (not catalog): `<title>Gorshey</title>` (brand name) and the static `—` placeholders in
  index.html, shown only until the first render. Neutral placeholders by design (ARCHITECTURE §7).

## M6 presence (Supabase Realtime)
- Dependency: `@supabase/realtime-js` 2.117.2, already installed from M0 (no new package). Unpacked 754,305 bytes;
  transitive `tslib`, `@supabase/phoenix`. The main bundle grew to 78.33 kB (24.01 kB gzip).
- Connects lazily on the first active engine state (playing, buffering or loading). Nothing opens a socket at boot.
- State model: disabled | idle | connecting | listening | watching | backoff | offline. Timeout 10 s, backoff 1 s doubling to 30 s
  with ±20% jitter. `pagehide` and `destroy()` leave the channel and clear timers. Offline stops attempts until `online`.
- Rate limit: presence calls are coalesced (1 s) and bucketed. The bucket is 5 calls per 30 s, a configurable constant.
  Docs wording, as fetched on 2026-10-07: table row "Presence calls per client, per 30 seconds: 5 5 5 5 5"
  (https://supabase.com/docs/guides/realtime/limits). The docs do not say what counts as a call; track() and untrack()
  are assumed to count.
- Free-tier limits (same page): concurrent connections 200; messages per second 100; channel joins per second 100;
  presence messages per second 20; presence keys per object 10.
- Badge: the listener count only while watching or listening with a number. Otherwise the catalog placeholder.
- Per-tab key: `sessionStorage` key `gorshey.presenceKey`, with an in-memory fallback when storage is blocked.
- Build step: `tools/check-dist.mjs` fails the build if dist/ contains service_role, sb_secret, SUPABASE_SERVICE_ROLE_KEY
  or secret-key.
- Not done: `.env.example` (a shell read was denied by the tool permissions; the names are in `src/presence/config.ts`).

## M6 evidence and pending checks
- Code: 20053de (presence state machine, realtime adapter, badge, wiring, dist check). Line endings: dd32f79 (.gitattributes, LF).
- Tests: 328 passing. No socket before the first play: `tests/presence.test.ts`, describe "no socket before the first play",
  test "constructing and waiting creates no transport and opens no socket". Red run before implementation: 31 failing in the presence,
  backoff and build-secret files; 3 failing badge tests in render.test.ts.
- Docs wording for the presence-calls limit: the Limits page gives it as a table row, "Presence calls per client, per 30 seconds"
  with 5 for every plan (https://supabase.com/docs/guides/realtime/limits). The docs do not state what counts as a call.
- Bundle: only VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY names appear; the dist secret check reports 0 hits.
- **Pending, live (not run here):** acceptance 1, the count rising and falling within seconds across two real tabs;
  acceptance 2, blocking the Supabase domain in DevTools leaves playback working with the badge at "—".
  Lazy connection in main.ts is wired but not covered by a test; the Presence class is.
