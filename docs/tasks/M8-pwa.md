# M8 — PWA

**Goal:** installable app with offline shell, correct audio bypass, and user-controlled updates.
**Skills:** `gorshey-audio-sync` §5.

## Files
`src/sw.ts`, `public/manifest.webmanifest`, `public/icons/*` (192, 512, maskable 512, apple-touch 180),
`src/ui/updatePrompt.ts`, updates to `vite.config.ts` and `index.html`

## Steps
1. `vite-plugin-pwa` with `strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.ts'`, `injectRegister: false`
   (register manually in `main.ts` so the update prompt controls activation).
2. `sw.ts` routing exactly per ARCHITECTURE §6 and skill §5: early return for non-GET, other origins, `Range` requests.
3. Web app manifest: `name "Gorshey · སྒོར་གཞས།"`, `short_name "Gorshey"`, `display "standalone"`,
   `background_color`/`theme_color` from tokens, `start_url "/"`, icons incl. maskable.
   `index.html`: `apple-mobile-web-app-capable`, `apple-mobile-web-app-title "Gorshey"`, apple-touch-icon.
4. Icons: original simple mark (kora ring + palace silhouette). Generate PNGs from one SVG in a script.
5. Update flow: new SW waiting → `updatePrompt` shows `update.available`; on click → `postMessage('SKIP_WAITING')` → reload.

## Acceptance
- Lighthouse "installable" passes; offline reload shows the shell with `player.offline` state.
- DevTools Network: audio requests show "(from ServiceWorker)" **never**; seeking still produces 206 responses.

## Font precache (added after M5)
- Precache the Tibetan font in the service worker: `/fonts/NotoSerifTibetan-tibetan-subset.woff2`. The page preloads it
  on every load, so it is always needed. Precache `/fonts/OFL.txt` with it.
- Media (audio, artwork) stays out of the precache, per ARCHITECTURE §6.
