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
- [x] M6  Presence (Supabase): accepted by Kunshe (evidence: 20053de, dd32f79; live checks confirmed)
- [x] M7  Media Session: accepted by Kunshe (evidence: 8283f6f, c4562db; live checks confirmed)
- [x] M8  PWA (manifest + service worker): accepted by Kunshe (evidence: 0029194, c2c2d0b; live checks confirmed)
- [x] M9  Theme polish: accepted by Kunshe (evidence: 1353a96, ed0535c, caa5509, ab57b34; Lighthouse and visual review confirmed)
- [ ] M10 QA (devices, Tibetan rendering, security review) (automated pass, security review, fixes F2-F8 and F14 done and F14 confirmed in Chrome, secrets moved out of the repo; desktop QA rows pending)
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
- [x] ARCHITECTURE §0 named a non-existent `tools/upload-r2.ts`; fixed in M10 (it is `upload-media.ts` with `STORAGE_BACKEND=r2`).
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
- Artwork inside the ring: wired in M5b (78c96f9, `paintArtwork` in `render.ts`) and finished in M9 (hidden until
  `load`, hidden on `error`, same-URL repaint is a no-op, width/height/decoding attributes). See "M9 theme polish".
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
- [x] Lighthouse CLS check on the production build (mobile emulation), with the Tibetan web font swapping in. Target: CLS ≈ 0.
  (M9: Lighthouse CLS 0.011.)
- [x] Layout at 375x667 in both languages: no page scroll, play button and next-up line fully visible (round 4 check).
  (M10 e2e: no horizontal scroll, no clipped box, both locales.)
- [x] (from M9) CLS after play: `#position` goes from empty to "m:ss / m:ss" when ticks start. Measure; reserve its
  height if the shift lands more than 500 ms after the click.
- [x] (from M9) bo first visit on Slow 4G: index.html ships `lang="en"`, so a paint before the module runs would lay
  out bo rows with Latin line heights. Watch for a vertical jump of the brand, next-up line and footer.
- [x] (from M9) Lint: add `no-eval` and `no-new-func` to the ESLint config. (8cdf592, plus `no-implied-eval`.)
- [x] (from M9) SEO: check `robots.txt` (Lighthouse SEO 92 after M9) for the remaining points. (d393bca; Kunshe reruns Lighthouse.)
- [ ] (from M8/M9) Phone pass: install, offline and lock-screen behaviour on iOS Safari and Android Chrome.

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
- `update.available` (bo: གསར་བཅོས་ཡོད།): shown on the M8 update button. Agent draft; the English says "A new version is
  available. Reload when you are ready." and the Tibetan draft is shorter. Needs native review.
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
- **Live checks, run by Kunshe and confirmed passing (2026-10-07):**
  - Before play the badge shows "—" and no websocket is open (covers the untested lazy connection in main.ts).
  - After play the kora badge shows 1.
  - Two windows: the count rises to 2, then falls back to 1 when one leaves (acceptance 1).
  - Offline: the badge shows "—" while audio keeps playing (acceptance 2).
  - Tibetan text displays correctly.

## M7 Media Session
- Built: `src/audio/mediaSession.ts` (`initMediaSession(engine, getLocale, tracks, env?)`, `metadataFor`, `playbackStateFor`),
  `tests/mediaSession.test.ts` (46 tests), wiring in `src/main.ts`. The module touches only `navigator.mediaSession` and
  `MediaMetadata`, never the DOM; `env` is injectable for tests.
- Actions: `play` → `engine.play()`, `pause` → `engine.pause()`. `seekto`, `seekbackward`, `seekforward`, `previoustrack`,
  `nexttrack` are set to `null` explicitly. Every `setActionHandler` call has its own try/catch (some browsers throw for
  unknown actions). A lock-screen play takes the same path as the button, so it always re-resolves from the clock
  (integration tests with the real AudioEngine).
- playbackState: idle → none; loading, playing, buffering → playing; paused, error → paused (error offers Play = retry).
- Metadata: title and artist via `pick(…, getLocale())`, album "Gorshey · སྒོར་གཞས།" (same as `station.name`), artwork
  `/artwork/artwork-192.jpg` and `/artwork/artwork-512.jpg`. Per-track manifest artwork is not used on the lock screen.
  The skill suggests 96/256/512; 192/512 chosen with Kunshe.
- **Locale decision: immediate.** `main.ts` calls `refresh()` on `onLocaleChange`, which rewrites the title and artist
  of the current track at once (tested).
- No `navigator.mediaSession`: a no-op handle, nothing thrown. No `MediaMetadata`: handlers and state still set.
- Artwork: `tools/make-artwork.mjs` (ffmpeg, crop 900x900 at 124,270, lanczos, JPEG q5, metadata stripped, reproducible bytes).
  Sizes: 192 → 10,086 bytes, 512 → 56,163 bytes. PNG was rejected: about 512 KB at 512 px (about 187 KB quantised).
  Source and licence in `public/ASSETS.md`. M8 note added: exclude `/artwork/` from the service worker.

## M7 evidence
- Commits: 8283f6f (mediaSession, wiring, artwork script and JPEGs, ASSETS.md), c4562db (docs, M8 artwork note).
- Tests: 374 passing, 46 in `tests/mediaSession.test.ts`. Red run before implementation: 37 failing, 9 passing against an
  exports-only stub. Coverage on src/core still 100% branches.
- **Live checks, run by Kunshe and confirmed passing (2026-10-07), desktop Chrome and phone:**
  - Metadata (title, artist, album) and the Potala artwork show.
  - Play and pause work from the system controls.
  - No seek or skip controls.
  - The title switches language immediately on a locale change.
- Not reported in this round, carried to the M10 device pass (skill §6): the track boundary passing while the screen is
  locked, and a lock-screen play after a long pause rejoining live (covered by tests, not yet seen on a device).

## M11 checklist additions
- [ ] Vercel headers: `Cache-Control: no-cache` for `/sw.js`, `/index.html` and the track manifest `/manifest.json`
  (ARCHITECTURE §9). There is no `vercel.json` yet. Without this, a CDN-cached `sw.js` delays updates and a CDN-cached
  track manifest defeats the network-first strategy.
- [ ] Replace placeholder track artwork (media/art/song*.jpg), re-upload, run npm run manifest. Today both tracks
  point to one 512x512, 1,757-byte, almost black JPEG, which shows as a black disc in the ring. Real covers should
  stay within the 16 KB artwork reserve in `tools/check-budget.mjs` (or raise the reserve deliberately).
- [ ] Resolve the licence of the lock-screen artwork source (`potoala_palace.png`, user-provided wallpaper; see
  `public/ASSETS.md`). Replace the image if the licence cannot be confirmed.
- [ ] (from M9) Licences: track licences (deferred by Kunshe) and the covers that replace the placeholder artwork.
- [ ] (from M9) Footer facts: confirm "Marpo Ri · 3,700 m · 1645" (and the bo `footer.line`) before launch.
- [ ] (from M9) `npm run i18n:review` reports zero unreviewed bo strings (M11 task requirement).
- [ ] (from M10) Move the two credential files out of the repo into the per-user secrets folder
  (`%APPDATA%\gorshey\supabase-service-key.env`, `%APPDATA%\gorshey\r2-credentials.env`, or `GORSHEY_SECRETS_DIR`),
  rotate the Supabase secret key once after the move, add the `.claude/settings.json` deny rules for the folder, and
  confirm `npm run upload` no longer refuses (it refuses while `tools/.supabase-service-key.env` exists).
  Kunshe, 2026-10-13: file moved to `%APPDATA%\gorshey\` (no R2 file exists yet), key rotated, deny rules added.
  Open: confirm `npm run upload` passes its preflight on the next real upload.

## M8 PWA
- No new dependency: `vite-plugin-pwa` 2.0.0 and workbox 7.4.1 are devDependencies since M0 (42ccfde). Build-time only;
  the main bundle has no workbox code (no `virtual:pwa-register`, no workbox-window). The plugin subtree is 329 packages
  (297 only through it, about 34.7 MB on disk, mostly workbox-build's rollup/babel). `dist/sw.js`: 15,476 bytes minified,
  5,430 bytes gzip -9. The plugin prints a harmless "inlineDynamicImports is deprecated" warning under vite 8.
- Built: `src/core/swRoute.ts` (pure routing, under the 100% branch threshold), `src/sw.ts` (one fetch listener),
  `src/pwa/updates.ts` (registration and update handshake, no DOM), `src/ui/updatePrompt.ts`, `src/ui/freshManifest.ts`,
  `showBootFailure` in `src/ui/render.ts`, `loadManifestWithSource` in `src/net/loadManifest.ts`,
  `public/manifest.webmanifest`, `tools/make-icons.mjs` + `tools/icon/gorshey-mark.svg`, `tools/check-precache.mjs`,
  `tsconfig.sw.json` (WebWorker lib; lint and build type-check it).
- Decisions (approved): track manifest network-first, no timeout (ARCHITECTURE §6 updated); icons from a built-in
  rasteriser of a restricted SVG subset that refuses anything else; one reload on `online` after a cached-manifest boot,
  never while loading, playing or buffering.
- Routing order: non-GET → other origin → Range → media path (`/artwork/`, `/audio/`, audio extensions) → track manifest
  → navigation (precached index.html) → precached URL → bypass. Every bypass returns without `respondWith`.
- Update flow: waiting worker → `#update` button (`update.available`) → click posts `SKIP_WAITING` → reload on
  `controllerchange`, once, only after the click. A first install never prompts. `reg.update()` runs when the page
  becomes visible. The prompt never pauses or reloads on its own; the click does reload (and stops audio) by design.
- Offline: cached track manifest → shell with `player.offline`; a play attempt ends in `error` after one retry (test).
  No track manifest at all → `showBootFailure`: brand, `player.offline` (or `player.error` online), play disabled,
  placeholders kept.
- Dev: no service worker (`devOptions.enabled: false`; registration only when `import.meta.env.PROD`; dev unregisters
  leftovers).
- Icons (`public/icons/`): icon-192.png 3,000 B; icon-512.png 7,717 B; icon-maskable-512.png 6,597 B (mark scaled to
  80%, test checks the safe zone); apple-touch-icon-180.png 2,769 B. All RGB, no alpha. A test re-renders the 192 icon
  from the SVG and compares bytes.
- Precache (12 entries, 274.96 KiB): manifest.webmanifest, index.html, 4 icons, hero SVG, grain PNG, Tibetan font,
  OFL.txt, the hashed JS and CSS. No track manifest, artwork, audio or markdown (checked on every build).
- Testing: `tests/swRoute.test.ts` (core), `tests/sw.test.ts` (fake ServiceWorkerGlobalScope, workbox mocked),
  `tests/pwaUpdates.test.ts` (fake container), `tests/pwaShell.test.ts` (static: manifest, icons, html, config),
  `tests/offline.test.ts`, and DOM tests in `tests/render.test.ts`. Coverage numbers cover `src/core` only; real caching,
  206 responses and update timing are manual checks.
- Red run: 44 failing tests against export-only stubs, plus `tests/pwaShell.test.ts` failing at collection (no
  `public/manifest.webmanifest` yet).

## M8 evidence
- Commits: 0029194 (service worker, web app manifest, icons, user-controlled updates), c2c2d0b (docs: network-first
  track manifest in ARCHITECTURE §6, M8 notes, review and M11 items).
- **Live checks, run by Kunshe on the production preview in desktop Chrome and confirmed passing (2026-10-12):**
  - The service worker is active and controls the page.
  - Audio and artwork requests are never "(from ServiceWorker)"; audio requests return 206.
  - The track manifest is fetched from the network (304 revalidation).
  - An offline reload shows the shell and the offline state.
  - The reload on reconnect works.
  - The app installs.
  - Lighthouse mobile: Performance 97, Accessibility 100, Best Practices 100, SEO 83, CLS 0.
- Not covered in this round: phone install and offline behaviour on iOS/Android. These are carried to the M10 device pass.

## M9 checklist additions
- [x] Add a favicon `<link>` in `index.html`. `/favicon.ico` currently returns 404. (M9: `rel="icon"` to icon-192.png.)
- [x] Add a `<meta name="description">`. This is the cause of Lighthouse SEO 83. (M9: one English sentence.)
- [ ] Note: LCP was 2.6 s in the M8 Lighthouse run (lab, throttled mobile). No action yet; re-measure after M9.
  M9 headless proxy (not Lighthouse) below; Kunshe reruns Lighthouse.

## M9 theme polish
- Task file reconciled: step 1 (grain) and step 2 (Potala mark) were done differently in M5b (`public/grain/grain.png`
  tile, `public/hero/hero-potala.svg` full-bleed hero); both untouched. Steps 3-6 done here.
- Artwork (approved): per-track artwork from the manifest, no fallback image. `<img id="artwork">` has
  `width="512" height="512" decoding="async"`, no preload, no lazy. Hidden whenever `src` changes, shown only on
  `load`, hidden on `error`; a repaint with the same URL is a no-op. Fixed bug: a locale change used to un-hide a failed
  image (broken-image icon). The image is absolute inside the fixed-size halo, so it never shifts layout. Service-worker
  routing unchanged (artwork and the media CDN still bypass it).
- Presence dot: `data-live` only when the badge shows a real count. Live: gold with a 2.4 s opacity/scale pulse, declared
  only under `prefers-reduced-motion: no-preference` (static gold otherwise). Placeholder "—": static maroon, no pulse.
- Kora ring: `.halo[data-active]` while loading/playing/buffering (same set as the play label). Track stroke gold at 0.35
  alpha when active, whitewash at 0.12 when not; 0.6 s colour transition only when motion is allowed. Fill and
  `setRing` unchanged; the SVG stays aria-hidden.
- index.html: `<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">` (existing, precached
  icon) and one English `<meta name="description">`. Not in the catalogs: it is static, read by search engines and
  link previews before JS runs, never shown in the UI, and HTML has no standard per-language description in one page.
- Footer: `class="caps"`; `.caps:lang(en)` uppercases and tracks. `en.footer.line` is now sentence case
  ("Marpo Ri · 3,700 m · 1645"); bo.json untouched.
- Fixed (pre-existing since M5b): `.mono` set `letter-spacing: 0.12em` and the mono stack unscoped, and components.css
  loads after base.css, so it beat `:lang(bo)` at equal specificity. The bo eyebrow got tracking and the mono stack.
  Now `.mono:lang(en)` carries the stack and tracking; `.clock` keeps the mono stack (digits only, agreed decision).
  Static test: every non-normal `letter-spacing` and non-none `text-transform` is scoped to `:lang(en)`. Headless
  Chrome check of computed styles on every element with Tibetan text (375 and 1280, en and bo): 0 violations.
- Tibetan font preload kept as is (deliberate: the Tibetan brand is on screen on every load). Precache unchanged.
- Budget: `tools/check-budget.mjs` runs last in `npm run build`. It counts index.html, the referenced JS and CSS, hero,
  grain, both manifests (text gzip -9, PNG raw) plus a 16 KB reserve for the remote track artwork, which the build cannot
  measure. Fails over 60 KB (61,440 B). M9 build: 50,465 B incl. reserve; with today's 1,757 B artwork, 35,838 B.
- LCP/CLS proxy (headless Chrome, NOT Lighthouse): 375x667 mobile, 4x CPU, 150 ms RTT, 1.6 Mbit/s, cache off, fresh
  profile, 3 runs per locale. LCP element: the artwork. LCP median en 1,768 ms, bo 1,732 ms; FCP about 0.8 s.
  CLS 0.121 (en) and 0.126 (bo), one shift at about 1.56 s.
- RESOLVED in M9 (caa5509, approved by Kunshe): boot-fill CLS. Pre-existing (the HEAD build before M9 measured the same
  0.121 / 0.126 from the same sources); Lighthouse in M8 showed CLS 0, probably because its simulated throttling fills
  the text before first paint.
  - Measured (track manifest paused via CDP Fetch, then released; 375x667 and 1280x800): rows that grew from the
    placeholder to the filled state: en `#station` 27 -> 38 px, `#nextup` 18 -> 25.83 (375) / 20 -> 28.88 (1280),
    `#footer` 4 -> 17; bo only `#footer` 4 -> 24.89. Everything else kept its height and only moved with the centred column.
  - Fix: `.station` and `.nextup` `min-height: 1.9em` (both always contain a Tibetan run; em follows the short-phone
    font size), `.footer` `min-height: calc(4px + 1lh)` (padding plus one line of its own line height: mono in en,
    1.9 in bo). Static tests in `tests/m9-static.test.ts`.
  - After: placeholder and filled heights and positions identical for every row, both locales, both sizes. Filled
    positions equal the pre-fix filled positions, and 375x667 paused (never played) screenshots before and after the fix
    are pixel-identical in en and bo (0 differing rows): the loaded layout did not change.
  - CLS proxy (same setup, 3 runs per locale): before 0.121 (en) / 0.126 (bo); after 0.0139 (en) / 0.0149 (bo), identical
    in every run. LCP median after: en 1,724 ms, bo 1,712 ms (artwork); FCP about 0.8 s.
  - Remaining shift (about 1.6 s, horizontal only, no y or height change): `#station`, `#nextup`, `#locale`, `.controls`
    and `#clock` widen from "—" to their text, and centred or right-aligned boxes move their left edge. Not reserved:
    it would need fixed widths, a design change.
  - Residual risk: index.html ships `lang="en"`, so in bo a paint before the module runs would lay out with Latin line
    heights and shift when `applyDocumentLang` sets bo. Not observed in the proxy (no shift before about 1.6 s).
- Play-time note (not boot): `#position` goes from empty (0 px) to "m:ss / m:ss" when ticks start after play. If that is
  more than 500 ms after the click it counts as CLS. Not measured (the proxy never presses play). Check in M10.
- Incident: the screenshot script blocked `*supabase.co/realtime*` with CDP `Network.setBlockedURLs`, which does not
  apply to WebSockets. The 4 playing captures joined the live presence channel as one listener each (badge "1 on the
  kora") and left when the tab closed. No data written (presence has no tables).
  **Rule (Kunshe, standing):** every browser script must stub `WebSocket` in the page (via
  `Page.addScriptToEvaluateOnNewDocument`) and must never press play against the live channel. URL blocking is not enough.
- Testing: red run 19 failing tests plus 1 suite failing at import (`tools/check-budget.mjs` missing); after: 502
  passing. New: `tests/m9-static.test.ts`, `tests/check-budget.test.ts`; extended `tests/render.test.ts`.
- Screenshots (not committed): `scratch/m9/{375x667,1280x800}-{en,bo}-{playing,paused}.png`. Script:
  `scratch/m9/shoot.mjs`; reports `shots-report.json`, `perf-proxy.json`; red run `red-run.txt`.
- CLS fix artefacts: red run `red-run-cls.txt` (3 failing); row measurements `rows-before.json`, `rows-after.json`;
  proxy `perf-proxy-after.json`; `375x667-{en,bo}-paused-{before,after}-cls.png`. Tests after: 506 passing.

## M9 evidence
- Commits: 1353a96 (theme polish, artwork load handling, budget check), ed0535c (docs), caa5509 (boot-fill row
  heights), ab57b34 (docs: CLS resolved).
- **Accepted by Kunshe (2026-10-13).** Lighthouse mobile, run by Kunshe: Performance 97, Accessibility 100, Best Practices
  100, SEO 92 (83 in M8), CLS 0.011, LCP 2.6 s.
- Headless CLS proxy (not Lighthouse): 0.0139 (en), 0.0149 (bo); 0.121 / 0.126 before the boot-fill fix.
- Page-load budget (`tools/check-budget.mjs`): 49.3 KB of 60 KB, including the 16 KB artwork reserve.
- Carried to M10: CLS after play (`#position`), bo first visit on Slow 4G, `no-eval` / `no-new-func` lint, robots.txt
  for the remaining SEO points, phone install/offline/lock-screen pass (see "M10 checklist additions").
- Carried to M11: artwork replacement (16 KB reserve), licences, footer facts, Vercel Cache-Control headers,
  `i18n:review` zero (see "M11 checklist additions").

## M10 QA and security review
- Tooling (no new dependencies): `tools/e2e.mjs` (headless Chrome over CDP with Node's WebSocket; `npm run e2e` against
  `vite preview`; not in `npm test` or `npm run build`; WebSocket stubbed unless a caller opts out),
  `tools/preview-headers.mjs` (the header set in vercel.json shape, origins derived from the build; serves dist/ with
  them). Docs: `docs/SECURITY-HEADERS.md`, `docs/QA-CHECKLIST.md`. Measurements and screenshots: `scratch/m10/`.
- Task file reconciled: Playwright, Semgrep, the Trail of Bits skills, `webapp-testing` and `web-design-guidelines` are
  not installed. Replaced (approved) by the CDP scripts, a scripted grep review of tracked `src/` and `tools/`, a manual
  diff review of all 54 commits, and a hand accessibility pass. WebKit/Safari and Firefox stay manual (QA-CHECKLIST).
- Carry items: (1) lint rules done (8cdf592; `no-implied-eval` needed the timer globals declared in flat config).
  (2) CLS after play: 0 in 6 runs (position fills about 15 ms after the click, `hadRecentInput`), but a visible jump (F6).
  (3) bo first visit: reproduced (F5). (4) SEO: `vite preview` served `index.html` for `/robots.txt` (200 text/html);
  fixed (d393bca), Kunshe reruns Lighthouse. (5) bundle: 81,305 B raw / 24,986 B gzip; `@supabase/realtime-js` 30.7 KB
  and `@supabase/phoenix` 25.6 KB raw (69%, about 17 KB gzip); app code about 24 KB. No change.
- Presence rule: every script stubbed WebSocket except the ONE approved CSP run: one tab, 3 s (2026-10-13, 16:09 UTC),
  wss handshake 101, badge "1 on the kora", closed.

### M10 findings

| id | severity | evidence | recommended action | status |
| :--- | :--- | :--- | :--- | :--- |
| F1 | Medium (process) | The agent's recursive secret grep over `tools/` read `tools/.supabase-service-key.env` (forbidden by CLAUDE.md). Output was masked, but 3 characters of the key body after `sb_secret_` reached the session. The file is untracked and git-ignored; history is clean. | Rotate the Supabase secret key (cheap). Scripts now use `git grep` (tracked files only) or explicit excludes. | rotation by Kunshe; CLAUDE.md hard rule f27a978 |
| F2 | Low | Presence `connect()` is wrapped in try/catch only on the first `setListening`. When `transport.subscribe()` throws (stubbed or CSP-blocked WebSocket), the backoff timer and `onOnline` paths raise an uncaught exception. Playback unaffected; presence recovers via the 10 s subscribe timeout. Seen in `scratch/m10/csp-stubbed.json`. | Catch around `tr.subscribe` in `connect()` and call `failTransport()`; red test: subscribe throws on a retry. | fixed d2b3ff4 |
| F3 | Low | `parseManifest` accepts any non-empty string for `src` and `artwork` (no scheme check). Mitigated: CSP `media-src`/`img-src` allow only the media origin, and browsers do not run `javascript:` in media or img. | Require absolute `https:` URLs for `src` and `artwork`; red tests for `javascript:`, `data:`, `http:`. | fixed 7fdee85 |
| F4 | Low | `check-dist` matches 4 literal strings. It misses legacy service-role JWTs (the role sits inside the base64 payload), R2 keys and generic tokens. The bundle today has one `sb_publishable_` key and no JWT. | Decode `eyJ…` payloads and fail unless the role is `anon`; add R2 key patterns. | fixed a3c6bca |
| F5 | Low | Cold bo load: first paint uses `lang="en"` line heights; `applyDocumentLang` then shifts the column 16 px (score 0.0159; Lighthouse-like and DevTools Slow 4G profiles, 3 runs each). bo boot CLS 0.039 in total. Frames: `scratch/m10/bo-first-*`. | Options: A inline head script (needs a CSP hash, second lang writer); B reserve bo heights for all rows (changes the en layout); C hide `.player` until `applyDocumentLang` marks the document ready (locale.ts stays the only writer, no CSP change); D accept (< 0.1). Recommendation: C. | fixed 86bdc32 (option C) |
| F6 | Low (UX) | Play makes the column jump: `#position` adds a line (20 px en, 27 px bo) and the pill widens ("Play" to "Pause", +11-12 px), which can wrap a long Tibetan title (strip 138 to 199 px in bo). Not CLS (input). | Reserve one line for `.position` (`min-height: 1lh`) and give the play pill a min-width for its longer label. Changes the paused layout slightly. | fixed f6fd6de |
| F7 | Low (visual) | Before JS runs, `.ring-fill` has no dash values, so the skeleton shows a full gold ring that then turns grey (frame 1 in `scratch/m10/bo-first-*`). | CSS default `stroke-dasharray`/`stroke-dashoffset` = circumference, so the fill starts empty. | fixed 8422568 |
| F8 | Low (a11y) | `#update` is a button with `aria-live` that starts `hidden`; a live region that is not rendered when its content changes is usually not announced. | Announce the update through the existing polite `#status` region (or a persistent visually hidden region); keep the button for the action. | fixed 1634f90 |
| F9 | Info | Presence code is 69% of the JS. | Optional: lazy-load the transport on first play (dynamic import). | no action |
| F10 | Info | Non-text contrast: ring track dim 1.33, gold 1.97; dot maroon 2.95, gold 4.79. Decorative and aria-hidden; state is also in text (play label, badge). All text passes AAA (lowest 8.29). | None required (WCAG 1.4.11 does not apply). | no action |
| F11 | Info | Dependencies: `npm audit` 0; 3 runtime packages; only install script is esbuild `postinstall` (still unapproved, build fine); `prettier` unused by scripts (`.prettierrc` for editors); `@supabase/supabase-js` dev-only (upload tool), not in the bundle. | None. | no action |
| F12 | Info | The CSP depends on the Supabase host; an R2 migration changes the media and artwork origins. `upgrade-insecure-requests` omitted (all https, HSTS). | Regenerate the headers after any storage move (SECURITY-HEADERS.md). | documented |
| F13 | Info | `tools/upload-media.ts` env parser assigns any key name (incl. `__proto__`) from the local credentials file. Trusted local input only. | None now. | no action |

Fixed in M10 (one finding per commit): lint sinks (8cdf592), robots.txt (d393bca). Tooling: e2e (f4e6504), header set
and preview (a89e22d).

Process notes (honest record):
- `tools/preview-headers.mjs` was written before its tests (`tests/preview-headers.test.ts`, test-after, 10 passing);
  the test found that `serve()` mis-joined an absolute dist path (fixed before commit). Two files were created beyond
  the approved list: `tools/preview-headers.d.mts` (types for the test import) and `tests/preview-headers.test.ts`.
- A commit command piped `npm run lint` into `tail` before `&&`, so a lint failure did not stop the commit of a89e22d.
  The 318 errors were all in `scratch/m10/` (a minified sourcemap build and a scratch script); the committed files were
  lint-clean. The scratch build was deleted and lint is clean.

### M10 decisions and fixes (Kunshe, 2026-10-13)
- F1: Kunshe rotates the Supabase secret key. Hard rules added to CLAUDE.md (f27a978): no recursive grep/rg/find/cat
  over `tools/` or any secret-holding directory, `git grep` / `git ls-files` only; never print or quote any part of a
  key; gate commands are never piped into something that hides their exit code; browser scripts stub WebSocket.
- `scratch/**` is ignored by ESLint (36d436e, with a test).
- One finding per commit, tests first with a full red run each time:

| id | commit | red run | change | before -> after |
| :--- | :--- | :--- | :--- | :--- |
| F2 | d2b3ff4 | 3 failing | `connect()` catches a throwing `subscribe()` and calls `failTransport()` (backoff) on every path | browser: uncaught "WebSocket not available" -> 0 exceptions (csp-stubbed-final) |
| F3 | 7fdee85 | 27 failing | `src`/`artwork`: absolute `https:` with host and no credentials, or `/path`; refuses javascript:, data:, blob:, http:, `//`, bare relative, malformed, whitespace, controls, backslash; error never echoes the value | all fixtures and the dev manifest already https |
| F4 | a3c6bca | 9 failing | check-dist decodes JWT payloads (fails on role=service_role, anon allowed), flags R2/AWS/Cloudflare names and presigned-URL params; prints names only | 0 hits on the current dist |
| F7 | 8422568 | 1 failing | `.ring-fill` default `stroke-dasharray`/`-dashoffset: 283` | skeleton ring empty instead of full gold |
| F8 | 1634f90 | 6 failing | update announced once via a visually hidden span in `#status` (existing `update.available`, tagged with the UI language); `aria-live` removed from the button; `.sr-only` utility | no new string |
| F6 | f6fd6de | 6 failing | `.position` `min-height: 1lh`; `.controls` grid with aria-hidden sizer spans for every play/pause label in every locale (`i18n.tFor`) | column jump on play/pause 10 px (en) / 13.7 px (bo) -> 0 px; strip +20/+27 px -> 0; pill +11-12 px -> 0 (375x667 and 1280x800) |
| F5 | 86bdc32 | 6 failing | option C: `data-lang-ready` set by `applyDocumentLang` (locale.ts still the only lang writer) and on boot failure; `html:not([data-lang-ready]) .player { visibility: hidden }`; 6 s zero-length visibility fallback if JS never runs (exempt from reduced motion); `<noscript>` links same-origin `/noscript.css` (CSP unchanged; not precached) | see below |

- F5 numbers (headless proxy, not Lighthouse; cold load, cache off, 375x667, 4x CPU; median of 3):

| profile | locale | CLS before | CLS after | vertical before -> after | LCP before -> after | FCP before -> after |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Lighthouse-like (150 ms, 1.6 Mbit/s) | bo | 0.0389 | 0.0153 | 0.0159 -> 0 | 1,704 -> 1,732 ms | 792 -> 664 ms |
| Lighthouse-like | en | 0.0139 | 0.0043 | 0 -> 0 | 1,700 -> 1,784 ms | 788 -> 664 ms |
| DevTools Slow 4G (562.5 ms, 1.4 Mbit/s) | bo | 0.0309 | 0.0153 | 0.0159 -> 0 | 4,676 -> 4,728 ms | 1,620 -> 1,456 ms |
| DevTools Slow 4G | en | 0.0139 | 0.0043 | 0 -> 0 | 4,668 -> 4,680 ms | 1,632 -> 1,444 ms |

  LCP is the artwork in every run; the +12..84 ms is within run-to-run spread. FCP is earlier because the hero paints
  first while the player waits for the language. The remaining CLS is horizontal only ("—" widening to text).
  Checks: JS file blocked -> player hidden at 1.5 s, visible by 7.5 s, with and without reduced motion; JS disabled ->
  visible at once, 0 CSP violations; normal bo boot -> visible, lang bo, 0 violations; e2e 18/18; 375x667 fits in both
  locales (no page scroll).
- Note on F6: the pill is now as wide as the longest label (the Tibetan pause label), so the English pill is wider
  than before; the reserved position line adds one empty line under the artist while paused. Approved trade-off.

### New finding (M10, after the decisions)

| id | severity | evidence | recommended action | status |
| :--- | :--- | :--- | :--- | :--- |
| F14 | Medium (correctness, pre-existing since M5) | Before the first play, and while paused, the strip shows track index 0: `render.ts` starts with `trackIdx = 0` and only the engine's `track` event (on play) changes it. Next-up is computed from the clock. So whenever the schedule is in track 2, the title and next-up name the same song, and pressing play switches the title (seen during the F6 measurement: "Song of Mani" paused, "Auspicious Welcome 0:00 / 4:05" on play, then the cycle wrapped). | Paint the scheduled track from the clock at boot and on each paused tick or track boundary (resolve, never idx+1), without touching the engine. Red tests first. | fixed 245ab98 |

### Proposal (not implemented): keep secret files outside the repo folder (decide at M11)
1. Recommended: a per-user secrets directory outside the working tree, e.g. `%APPDATA%\gorshey\` on Windows and
   `~/.config/gorshey/` elsewhere, holding `supabase-service-key.env` and `r2-credentials.env`. `tools/upload-media.ts`
   reads the directory from `GORSHEY_SECRETS_DIR` (default: the per-user path) and refuses any path inside the repo.
   No agent search of the repo can reach the files; `.gitignore` and the settings deny list stay as defence in depth.
2. Stronger: no file at all. Keep the keys in a password manager or the OS store and inject them only for the upload
   run, e.g. `op run --env-file=...` (1Password CLI) or Windows Credential Manager via PowerShell SecretManagement;
   the upload tool reads `process.env` only.
3. Either way: move the two existing files out, rotate the keys once more after the move, and add a check to
   `npm run upload` that fails if a credentials file exists anywhere under the repo.

### M10 final items (Kunshe, 2026-10-13)
- **F14 fixed (245ab98, red run 7 core + 9 DOM failing).** New pure `shownTracks(nowMs, epochMs, starts, engineIdx)`
  in `src/core/schedule.ts` (same `resolve()` as the engine; 100% branches): the engine's track while it is
  loading/playing/buffering, the scheduled track otherwise; next is resolved 1 ms past the shown slot, so it equals
  the title only for a one-track manifest. `render.ts` paints title, artist, artwork and next-up from one call,
  repaints from the clock when playback stops and on the existing 1 s clock tick (`startClock(el, now, onTick)`),
  which covers boundaries (within 1 s). AudioEngine unchanged. Three M9 artwork tests now put the fake engine in
  `playing` before emitting a track (an idle engine's track no longer decides).
- To keep the boundary repaint from resizing the strip, the title reserves exactly two Tibetan lines at every size
  (min-height + `-webkit-line-clamp: 2`, gorshey-tibetan §2). A title longer than two lines is clipped with an
  ellipsis; current titles fit.
- **F6 follow-up (2ceba2a).** Found while measuring F14: `.play { font: inherit }` also hit the aria-hidden sizer spans
  and beat `:lang(bo)`, so in en mode the Tibetan sizers used a narrow fallback font and the pill was 92 px (140 px in
  bo). The F6 report over-claimed "the longest label in either locale": play/pause did not resize it, a locale swap
  did. `font: inherit` now applies to `button.play` only; the pill is 140 px in both locales.
- F14 layout numbers (headless Chrome; manifest epoch rewritten in flight so the schedule sits where needed):

| scenario | 375x667 bo | 375x667 en | 1280x800 bo | 1280x800 en |
| :--- | :--- | :--- | :--- | :--- |
| A boot inside track 2 (throttled), CLS | 0.0984 -> 0.0153 | 0.0043 | 0.0023 | 0.0008 |
| B paused, boundary 1->2, CLS after load | 0.0432 -> 0.0021 | 0.0022 | 0.0040 | 0.0042 |
| B paused, boundary 2->1, CLS after load | 0.0432 -> 0.0021 | 0.0022 | 0.0027 | 0.0004 |
| C play/pause inside track 2, column jump | 0 px | 0 px | 0 px | 0 px |

  "->" shows before/after the two-line title reservation (F14 without it, then with it). What remains is horizontal
  only: at boot the "—" placeholders widening into text; at a paused boundary the centred next-up text changing
  length (left edge moves 43-48 px, height +-1 px rounding). That boundary shift also happens during playback and did
  since M5; making it exactly 0 needs a design change (left-aligned or fixed-width next-up), not done. e2e 18/18;
  375x667 and 1280x800 still fit in both locales.
- **Secrets outside the repo (09ce531).** `tools/secrets.ts`: folder from `GORSHEY_SECRETS_DIR`, else
  `%APPDATA%\gorshey` / `~/.config/gorshey`; `npm run upload` refuses if the folder is the repo or inside it
  (case-insensitive on Windows, no prefix trap, symlinks resolved) and while any credentials file is inside the repo
  (git ls-files names + existence of 8 known paths; nothing is opened). Files: `supabase-service-key.env`,
  `r2-credentials.env`. `.gitignore` ignores credential-named files anywhere. ARCHITECTURE §10, CLAUDE.md and the
  M00 human setup updated. Tests: temp directories and fake empty files only (24). Kunshe moves the files, rotates the
  key once after, and adds the deny rules (M11 checklist).
- **F14 confirmed by Kunshe (2026-10-14)** in desktop Chrome (`npm run dev`): paused across a track boundary, title,
  artist, artwork and next-up changed together, never named the same song, and the strip did not move vertically.
- M10 stays open until Kunshe's desktop rows in `docs/QA-CHECKLIST.md` are filled in.

### M10 follow-ups (agent, 2026-11-05, on top of 0ea5a87)
Ported from a parallel M10 pass that had not seen 0ea5a87; everything that duplicated work already here (eval lint,
robots.txt, JWT decode in check-dist, scratch/ lint ignore, e2e, QA checklist) was dropped.
- **Upload test on Linux/macOS (ed42013).** `tests/upload-media.test.ts` checked `upload()`'s first argument (the
  local path) instead of the key: passed on Windows (`C:\`), failed on Linux/macOS (`/`). Test-only fix.
- **English subtitle in the bo UI (be13d85).** The subtitle `<p>` inherited `lang="bo"` and line-height 1.9: a long
  title took three 30 px lines (91 px instead of 60) and 375x667 scrolled. The paragraph now takes its run's language,
  the placeholder is `lang="en"`, and `base.css` resets `:lang(en)` to `line-height: normal` (en pixel-identical).
- **Title clamp shaved Tibetan marks (547d9c1).** Measured with the self-hosted font at size-adjust 125%: ink reaches
  1.46em above and 0.87em below the baseline, beyond a 1.9 line box; the two-line clamp's clip cut 12-16 px of stacked
  vowels (pixel diff, 375x667 and 1280x800, en and bo). `.title` uses `--bo-clamp-lh: 2.45` (>= 2.41 keeps both edges
  inside) and `min-height: 2lh`, so the F14 fixed two-line box is unchanged in behaviour. The ring allowance goes from
  430 to 465 px: with the real titles every tested size fits in en and bo, including 414x736 bo, which scrolled before
  (741 px). The ring is smaller below about 765 px of height (375x667: 237 -> 202 px). **Visual sign-off needed.**
  A claimed collision between wrapped lines at 1.9 did not reproduce here; next-up is unchanged.
- **Faster boot (54051bb).** `main.ts` fetches the track manifest in parallel with the coarse clock offset. Slow 4G +
  4x CPU, real manifest: data at about 3.4 s instead of 4.0 s.
- **color-scheme (e8e8b4a).** `color-scheme: dark` on `:root` (light on the disabled light slot): native scrollbars
  and controls follow the night theme.
- **Data gate (40dc2c0).** F5's language gate opens before the track manifest arrives, so a title or next-up line
  longer than its reserved lines still moved the column at boot (first visit, Slow 4G: CLS 0.157 bo / 0.122 en).
  `html:not([data-player-ready]) .player` keeps it hidden until mountPlayer's first paint or showBootFailure
  (`markPlayerReady` in locale.ts, still the only writer of document flags); same 6 s fallback and noscript.css.
  After: 0.0000 in en and bo; FCP unchanged; script blocked -> visible at 6.1 s (also under reduced motion); JS off ->
  at once.
- **Tibetan rendering page (0b43eb9).** `tests/tibetan-render.html` in `npm run e2e` (Chrome, DevTools Fetch, SW
  bypassed, built CSS): 11 checks with controls (see docs/QA-CHECKLIST.md). e2e now 29/29.
- Still open for Kunshe: the desktop and phone rows in `docs/QA-CHECKLIST.md`, the Tibetan page in Safari, and the
  visual sign-off on the smaller ring below 765 px.
