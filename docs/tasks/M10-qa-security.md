# M10 — QA & security review

**Goal:** confidence on real devices and a clean security pass before launch.
**Skills:** `webapp-testing`, `web-design-guidelines`, `gorshey-tibetan` §6, `gorshey-audio-sync` §6,
Trail of Bits `static-analysis` + `differential-review`.

## Steps
1. Playwright checks (`npm run e2e`): page loads, play starts after click (Chromium with autoplay policy),
   locale toggle, presence badge falls back to "—" with Supabase blocked, Tibetan title box height is not clipped
   (compare element `scrollHeight` vs `clientHeight`), screenshots for both locales.
2. Tibetan rendering test page `tests/tibetan-render.html` with the stack-depth strings; screenshots in Chromium + WebKit.
3. Run `web-design-guidelines` on `index.html` and `src/styles/`; fix findings or document why not.
4. Security: `static-analysis` (Semgrep) over `src/` and `tools/`; `differential-review` over the full history;
   grep `dist/` and git history for anything resembling keys besides the anon key.
5. Write `docs/QA-CHECKLIST.md` for the manual device matrix below and fill what you can.

## [HUMAN] Device matrix
iOS Safari (browser + installed PWA) · Android Chrome (browser + installed) · desktop Chrome/Firefox/Safari ·
Windows (Microsoft Himalaya fallback). Two phones side by side: in sync within ~1–2 s, across a track boundary,
after 5 min in background, with screen locked. Log anything odd in `gorshey-audio-sync/references/pitfalls.md`.

## Acceptance
All automated checks green; no high/critical findings open; device matrix signed off by Kunshe.
