# M1 — Content pipeline

**Goal:** one command turns `tools/tracks.source.yaml` + media files into a validated `public/manifest.json`,
and a separate script (run by Kunshe) uploads media to whichever storage backend is active — **Supabase Storage now,
Cloudflare R2 later** (see ARCHITECTURE §0). The manifest-building logic must not care which backend is active.
**Skills:** `gorshey-tibetan`, `supabase` (current backend), `cloudflare`/`wrangler` (reference for the R2 code path, used at migration).

## Files
```
tools/tracks.source.example.yaml   # committed template
tools/build-manifest.ts            # npm run manifest
tools/tibetan-normalize.ts
tools/upload-media.ts              # npm run upload — Kunshe runs it; backend chosen by STORAGE_BACKEND env var
tools/storage/supabase.ts          # upload + list + content-type/cache-header logic for Supabase Storage
tools/storage/r2.ts                # same interface, for R2 — written now, unused until migration
tests/tibetan-normalize.test.ts
tests/build-manifest.test.ts
```

## Source YAML shape
```yaml
epoch: "2026-01-01T00:00:00Z"
cdnBase: "https://<project-ref>.supabase.co/storage/v1/object/public/gorshey-media"
tracks:
  - file: media/audio/song1.m4a
    art: media/art/song1.jpg
    title:  { bo: "…", en: "…" }
    artist: { bo: "…", en: "…" }
```
`cdnBase` is the one line that changes at migration time — see ARCHITECTURE §0.

## Functions
- `probeDuration(path): Promise<number>` — `ffprobe -v error -show_entries format=duration -of csv=p=0`; float seconds.
- `contentHash(path): Promise<string>` — first 12 hex of SHA-256; used in object names on either backend.
- `normalizeTibetan(s): string` — exactly the rules in the gorshey-tibetan skill §4.
- `convertLegacy(s, encoding): string` — throws "not implemented: <encoding>" for now.
- `validateTrack(t): string[]` — errors for missing bo title, zero duration, missing files.
- `buildManifest(src): Manifest` — outputs the schema in ARCHITECTURE §8; `src` = `${cdnBase}/audio/${hash}.${ext}`.
  This function takes `cdnBase` as plain config — it has no knowledge of Supabase or R2.
- **Storage interface** (`tools/storage/*.ts`), same shape for both backends:
  ```ts
  interface StorageBackend {
    upload(localPath: string, remoteKey: string, contentType: string): Promise<void>;
    exists(remoteKey: string): Promise<boolean>;
  }
  ```
  - `supabase.ts`: uses `@supabase/supabase-js` storage client against bucket `gorshey-media`, with the
    **service-role key read only from `tools/.supabase-service-key.env`** (never the anon key — uploads need
    elevated rights; this file is gitignored and agent-denied same as R2 credentials). Sets `cacheControl: '31536000'`
    and `upsert: false` (skip existing).
  - `r2.ts`: S3-compatible client, credentials from `tools/.r2-credentials.env`, sets `Cache-Control:
    public, max-age=31536000, immutable`. Written and unit-testable now; not run until migration.
- `upload-media.ts`: reads `STORAGE_BACKEND` (default `supabase`), picks the matching module, uploads everything
  the manifest references, reports what it skipped vs uploaded. The agent writes it but does not run it.

## Steps
1. Tests first for `normalizeTibetan` (each rule) and `validateTrack`.
2. Implement `buildManifest` + both storage modules behind the shared interface (mock the SDKs in tests — no
   network calls from `npm run test`).
3. Run `node .claude/skills/gorshey-tibetan/scripts/check-tibetan.mjs public/manifest.json` as the last step of
   `npm run manifest` (fail the build on errors).
4. Generate a manifest from 2 short local test files (create silent test audio with ffmpeg) to prove the pipeline
   end to end without touching real credentials.

## Acceptance
- `npm run manifest` produces a valid manifest with measured float durations, regardless of which backend `cdnBase` points at.
- A YAML with a non-Unicode `bo` title fails the build with a clear message.
- `upload-media.ts` reviewed by Kunshe; no secrets in git; `tools/storage/r2.ts` compiles and has tests even though unused.

[HUMAN] After review: create the Supabase Storage bucket (`docs/tasks/M00-human-setup.md`), fill the real YAML,
run `npm run manifest`, then `STORAGE_BACKEND=supabase npm run upload`, verify one audio URL plays in a browser.
When migrating later: create the R2 bucket + credentials, update `cdnBase`, run `npm run manifest` again, then
`STORAGE_BACKEND=r2 npm run upload`.
