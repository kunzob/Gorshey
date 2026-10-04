# Gorshey — Progress Log

The agent updates this file at the end of every task. Newest notes at the bottom of each section.

## Milestones
- [ ] M00 Human setup (accounts, tools) — Kunshe
- [x] M0  Project scaffold
- [ ] M1  Content pipeline (manifest + R2 upload script)
- [ ] M2  Sync core (clock + schedule)
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

## Open questions / follow-ups
- Licensing of tracks: deferred by Kunshe; manifest stays source-agnostic.
- npm allow-scripts: decide whether to approve esbuild's postinstall (build works without it).
- Native-speaker review of Tibetan UI strings before launch.
