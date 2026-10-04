# Gorshey — Progress Log

The agent updates this file at the end of every task. Newest notes at the bottom of each section.

## Milestones
- [ ] M00 Human setup (accounts, tools) — Kunshe
- [ ] M0  Project scaffold
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

## Open questions / follow-ups
- Licensing of tracks: deferred by Kunshe; manifest stays source-agnostic.
- Native-speaker review of Tibetan UI strings before launch.
