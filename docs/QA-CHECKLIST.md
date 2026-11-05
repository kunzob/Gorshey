# QA checklist (M10)

Automated checks were run by the agent on 2026-10-13 (desktop, headless Chrome, Windows). Device rows are for Kunshe.
Measurements and screenshots live in `scratch/m10/` (git-ignored).

## Automated

| Check | How | Result |
| :--- | :--- | :--- |
| Unit and static tests | `npm run test` | 670 passing, 1 skipped (2026-11-05, after the M10 follow-ups) |
| Lint, types, sinks | `npm run lint` (incl. `no-eval`, `no-implied-eval`, `no-new-func`) | clean |
| Build, precache, secrets, budget | `npm run build` | 12 precache entries, 0 secret-like hits, 50.0 KB of 60 KB (after the M10 fixes) |
| Browser e2e | `npm run e2e` (headless Chrome, WebSocket stubbed) | 29/29 (2026-11-05): the 18 player checks (load, lang, no clipped Tibetan boxes, no horizontal scroll, play, presence placeholder, pause, toggle) plus 11 on `tests/tibetan-render.html` (see below) |
| Tibetan rendering page | `npm run e2e`, page served at `/__e2e/tibetan-render.html` with the built CSS | font face loaded; title clamp cuts no ink (control at 1.9 cuts 8 px); ink fits the title's line box (2.45: 0.10em / 0.02em to spare); wraps only after tsheg; same line box with the fallback; Tibetan not smaller than Latin; adjacent lines never touch (control at 1.5: 57 px) |
| CSP | `tools/preview-headers.mjs` + headless Chrome | 0 violations, both locales, SW install and controlled reload |
| CLS on boot | headless proxy, 3 runs per locale | after F5: en 0.0043, bo 0.0153, horizontal only (before: bo 0.0389 incl. a 0.0159 vertical lang flip). After the M10 data gate (2026-11-05), first visit on Slow 4G with a long title and next-up: 0.0000 in en and bo (was 0.122 / 0.157) |
| CLS after play | real CDP click, 10 s | 0; after F6 the column does not move at all on play or pause (was 10 / 13.7 px) |
| Keyboard | Tab / Enter / Space via CDP | order: language toggle -> play; 2 px gold focus ring; Enter plays, Space pauses, toggle keeps focus |
| Reduced motion | emulated media | dot pulse and ring transition off under `reduce` |
| Reflow / 200% zoom | 640x400 and 320x256 CSS px | no horizontal scroll, controls inside the viewport, nothing clipped |
| Text contrast | text made transparent, brightest background pixel | lowest 8.29:1 (artist); every text passes AAA |
| robots.txt | `vite preview` and header preview | `text/plain`, not precached |

Not automated here: WebKit/Safari, Firefox, real phones, screen readers, two-device sync. The Tibetan page checks run in Chrome only:
open the same page in Safari by hand (run `npm run e2e`, or serve `tests/tibetan-render.html` with the built CSS).

## Simulated device matrix (agent, Chromium emulation, 2026-11-05)

Chromium with Playwright device profiles against `vite preview` of the production build: emulation, **not** real
devices (no WebKit, no real lock screen, no OS audio policy). WebSocket stubbed; manifest and audio answered locally
except in the offline run. Script and screenshots: `scratch/devsim/` (git-ignored). The real-device tables below
still need Kunshe.

| Check | Result |
| :--- | :--- |
| Fits without scrolling, real titles (en / bo) | iPhone SE 3rd gen, iPhone 13, iPhone 15 Pro Max, Pixel 7, Galaxy S8, Galaxy S9+, iPad Mini: fit in both. iPhone SE 1st gen (320x568): en fits, bo scrolls 47 px (main: 54 px), ring already at its 160 px minimum |
| Fits with a long title and long next-up (stress) | every profile above except iPhone SE 1st gen (en 587/568, bo 641/568) |
| First tap plays, one media element, pause works | pass on every profile, en and bo |
| Lock-screen metadata (Media Session title + artwork) | set on every profile, en and bo |
| Two devices side by side | 0.02-0.17 s apart, also across a track boundary; position within 0.1 s of the global clock |
| Background: page frozen 6 s, then visible | still playing, 0.05-0.38 s apart from a device that stayed open |
| Play/pause column jump; boot CLS | 0 px; 0 (Galaxy S8 en/bo, iPhone 13 bo) |
| Paused track boundary on a tight screen | Galaxy S8 bo: CLS 0.023, the ring regrows 248 -> 257 px (main: 0.006, but the page scrolled 21 px and boot CLS was 0.154) |
| Service worker; installable | controls the page after one reload; Chrome installability check: no errors |
| Offline reload (airplane) | shell and the cached track load; "You are offline." shown at once |

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
