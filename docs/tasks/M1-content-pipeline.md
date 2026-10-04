# M1 — Content pipeline

**Goal:** one command turns `tools/tracks.source.yaml` + media files into a validated `public/manifest.json`,
and a separate script (run by Kunshe) uploads media to R2 with correct headers.
**Skills:** `gorshey-tibetan`, `cloudflare`/`wrangler` (for upload script correctness).

## Files
```
tools/tracks.source.example.yaml   # committed template
tools/build-manifest.ts            # npm run manifest
tools/tibetan-normalize.ts
tools/upload-r2.ts                 # npm run upload — Kunshe runs it
tests/tibetan-normalize.test.ts
tests/build-manifest.test.ts
```

## Source YAML shape
```yaml
epoch: "2026-01-01T00:00:00Z"
cdnBase: "https://cdn.example.com"
tracks:
  - file: media/audio/song1.m4a
    art: media/art/song1.jpg
    title:  { bo: "…", en: "…" }
    artist: { bo: "…", en: "…" }
```

## Functions
- `probeDuration(path): Promise<number>` — `ffprobe -v error -show_entries format=duration -of csv=p=0`; float seconds.
- `contentHash(path): Promise<string>` — first 12 hex of SHA-256; used in R2 object names.
- `normalizeTibetan(s): string` — exactly the rules in the gorshey-tibetan skill §4.
- `convertLegacy(s, encoding): string` — throws "not implemented: <encoding>" for now.
- `validateTrack(t): string[]` — errors for missing bo title, zero duration, missing files.
- `buildManifest(src): Manifest` — outputs the schema in ARCHITECTURE §8; `src` = `${cdnBase}/audio/${hash}.${ext}`.
- Upload script: S3-compatible client to R2 using credentials from `tools/.r2-credentials.env`
  (loaded at runtime, never logged), sets `Content-Type` and `Cache-Control: public, max-age=31536000, immutable`,
  skips objects that already exist. Add `npm run upload` script. The agent writes it but does not run it.

## Steps
1. Tests first for `normalizeTibetan` (each rule) and `validateTrack`.
2. Implement; run `node .claude/skills/gorshey-tibetan/scripts/check-tibetan.mjs public/manifest.json` as the
   last step of `npm run manifest` (fail on errors).
3. Generate a manifest from 2 short local test files (you may create silent test audio with ffmpeg).

## Acceptance
- `npm run manifest` produces a valid manifest with measured float durations.
- A YAML with a non-Unicode `bo` title fails the build with a clear message.
- Upload script reviewed by Kunshe; no secrets in git.

[HUMAN] After review: fill the real YAML, run `npm run manifest`, then `npm run upload`, verify one audio URL plays in a browser.
