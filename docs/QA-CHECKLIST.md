# QA checklist (M10)

Automated checks were run by the agent on 2026-10-13 (desktop, headless Chrome, Windows). Device rows are for Kunshe.
Measurements and screenshots live in `scratch/m10/` (git-ignored).

## Automated

| Check | How | Result |
| :--- | :--- | :--- |
| Unit and static tests | `npm run test:coverage` | 615 passing, 100% branches on `src/core` (after the M10 fixes) |
| Lint, types, sinks | `npm run lint` (incl. `no-eval`, `no-implied-eval`, `no-new-func`) | clean |
| Build, precache, secrets, budget | `npm run build` | 12 precache entries, 0 secret-like hits, 50.0 KB of 60 KB (after the M10 fixes) |
| Browser e2e | `npm run e2e` (headless Chrome, WebSocket stubbed) | 18/18: load, lang, no clipped Tibetan boxes, no horizontal scroll, play, presence placeholder, pause, toggle |
| CSP | `tools/preview-headers.mjs` + headless Chrome | 0 violations, both locales, SW install and controlled reload |
| CLS on boot | headless proxy, 3 runs per locale | after F5: en 0.0043, bo 0.0153, horizontal only (before: bo 0.0389 incl. a 0.0159 vertical lang flip) |
| CLS after play | real CDP click, 10 s | 0; after F6 the column does not move at all on play or pause (was 10 / 13.7 px) |
| Keyboard | Tab / Enter / Space via CDP | order: language toggle -> play; 2 px gold focus ring; Enter plays, Space pauses, toggle keeps focus |
| Reduced motion | emulated media | dot pulse and ring transition off under `reduce` |
| Reflow / 200% zoom | 640x400 and 320x256 CSS px | no horizontal scroll, controls inside the viewport, nothing clipped |
| Text contrast | text made transparent, brightest background pixel | lowest 8.29:1 (artist); every text passes AAA |
| robots.txt | `vite preview` and header preview | `text/plain`, not precached |

Not automated here: WebKit/Safari, Firefox, real phones, screen readers, two-device sync.

## Desktop (Kunshe, now)

| Check | Chrome | Firefox | Safari (mac) |
| :--- | :--- | :--- | :--- |
| Lighthouse mobile on `vite preview` after robots.txt (SEO should reach 100 or name the remaining audit) | | n/a | n/a |
| Keyboard only: Tab to the toggle and play, Enter/Space work, focus ring visible | | | |
| Screen reader: play label, status "Buffering…"/offline announced; update prompt announced once via #status (F8) | | | |
| OS reduced motion on: dot still, no ring fade | | | |
| Browser zoom 200%: no horizontal scroll, everything reachable | | | |
| Tibetan stack-depth strings render without clipped marks (gorshey-tibetan §6) | | | |
| Windows: Microsoft Himalaya fallback before the web font arrives | | n/a | n/a |
| CSP: run `node tools/preview-headers.mjs`, open it, DevTools console shows no CSP errors | | | |

## Phones (Kunshe, after the M11 deployment)

| Check | iOS Safari | iOS installed PWA | Android Chrome | Android installed |
| :--- | :--- | :--- | :--- | :--- |
| First tap plays | | | | |
| Two phones side by side in sync within 1-2 s | | | | |
| Across a track boundary | | | | |
| After 5 min in background, rejoins live on return | | | | |
| Screen locked: lock-screen controls (play/pause only), title, artwork | | | | |
| Lock-screen play after a long pause rejoins live | | | | |
| Install prompt / Add to Home Screen, icon, splash | | | | |
| Offline: shell and offline status; reload on reconnect | | | | |
| Update prompt appears after a deploy; click reloads | | | | |
| bo first visit on a slow network: player appears in Tibetan with no vertical jump (F5) | | | | |
| Paused before first play: title, artist and artwork match the scheduled track; at a track boundary while paused the strip changes without moving (F14) | | | | |
| Production response headers match docs/SECURITY-HEADERS.md (`curl -I`) | | | | |

Log anything odd in `.claude/skills/gorshey-audio-sync/references/pitfalls.md`.
