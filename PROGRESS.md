# Gorshey — Progress Log

The agent updates this file at the end of every task. Newest notes at the bottom of each section.

## Milestones
- [ ] M00 Human setup (accounts, tools) — Kunshe
- [x] M0  Project scaffold
- [x] M1  Content pipeline (manifest + R2 upload script)
- [x] M2  Sync core (clock + schedule)
- [ ] M3  Audio engine
- [ ] M4  i18n (bo / en)
- [ ] M5  UI shell (Potala theme, kora ring)
- [ ] M6  Presence (Supabase)
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

## Open questions / follow-ups
- Confirm the manifest version format (content hash vs ISO timestamp in ARCHITECTURE §8).
- ARCHITECTURE §0 says `tools/upload-r2.ts` is "already written" and names `tools/upload-media.ts`. The file that exists is `upload-media.ts`; no upload-r2 file exists. Fix the doc.
- Confirm the credential variable names above before Kunshe creates the files.
- Licensing of tracks: deferred by Kunshe; manifest stays source-agnostic.
- npm allow-scripts: decide whether to approve esbuild's postinstall (build works without it).
- Native-speaker review of Tibetan UI strings before launch.
