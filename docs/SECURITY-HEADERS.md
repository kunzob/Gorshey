# Security and cache headers (M10, for M11)

The header set lives in **one place**: `tools/preview-headers.mjs` (`headerRules()`). M11 copies its output into
`vercel.json`; do not hand-edit a second copy. Print it with:

```
npm run build
node tools/preview-headers.mjs --print     # vercel.json "headers" array
```

## Origins are derived, not typed

| Placeholder | Derived from | Current value (2026-10) |
| :--- | :--- | :--- |
| `<MEDIA_ORIGIN>` | `src` URLs in `dist/manifest.json` | `https://nfkubphegarcrznwjdlb.supabase.co` |
| `<ARTWORK_ORIGIN>` | `artwork` URLs in `dist/manifest.json` | `https://nfkubphegarcrznwjdlb.supabase.co` |
| `<SUPABASE_ORIGIN>` (presence) | `VITE_SUPABASE_URL` in the process environment, else the `*.supabase.co` URL Vite baked into `dist/assets/*.js` | `https://nfkubphegarcrznwjdlb.supabase.co` |

Nothing reads `.env` files. When storage moves to Cloudflare R2, `<MEDIA_ORIGIN>` and `<ARTWORK_ORIGIN>` change with the
re-uploaded manifest; rebuild and re-print the headers, then update `vercel.json`.

## Header set

Applied to every path (`/(.*)`):

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' <ARTWORK_ORIGIN>;
  media-src <MEDIA_ORIGIN>;
  connect-src 'self' <SUPABASE_ORIGIN> wss://<SUPABASE_HOST>;
  font-src 'self';
  manifest-src 'self';
  worker-src 'self';
  object-src 'none';
  base-uri 'none';
  form-action 'none';
  frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: accelerometer=(), bluetooth=(), browsing-topics=(), camera=(), display-capture=(), geolocation=(),
  gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), serial=(),
  usb=(), xr-spatial-tracking=()
```

Cache rules (later rules add to the security headers):

| Path | Cache-Control | Why |
| :--- | :--- | :--- |
| `/`, `/index.html` | `no-cache` | the shell must revalidate so a new build is picked up |
| `/sw.js` | `no-cache` | a CDN-cached worker delays updates (ARCHITECTURE §9) |
| `/manifest.json` (track manifest) | `no-cache` | a CDN-cached copy defeats the network-first strategy |
| `/assets/(.*)` | `public, max-age=31536000, immutable` | content-hashed file names |

Notes:
- **No inline `<style>` even in `<noscript>`** (M10 F5): the JS-less reveal is the same-origin `/noscript.css`, so
  `style-src 'self'` covers it.
- **No `'unsafe-inline'`.** `dist/index.html` has no inline script or style; the ring progress is set through CSSOM
  (`el.style.x = …`), which `style-src` does not govern. The M10 test found zero violations (below).
- **Permissions-Policy** deliberately does not mention `autoplay`, `fullscreen` or media session (not a policy feature).
- **`frame-ancestors 'none'`** replaces `X-Frame-Options` in every current browser; add `X-Frame-Options: DENY` only if
  an old-browser audit asks for it.
- **`upgrade-insecure-requests` is omitted**: every external URL is already https, Vercel sends HSTS, and the directive
  breaks plain-http local testing.
- **HSTS**: Vercel sends `Strict-Transport-Security` on its domains; not added here.

## Vercel preview deployments

- Preview deployments send `X-Robots-Tag: noindex`. Lighthouse SEO on a preview URL will flag "Page is blocked from
  indexing"; that is expected and does not apply to production.
- Previews may inject the **Vercel toolbar** (comments/feedback) script from `vercel.live`. The strict CSP blocks it
  (script-src, connect-src, frame-src), so on previews the toolbar fails and the console shows CSP violations. This is
  previews only; production has no toolbar. Options for M11: accept it, disable the toolbar for the project, or send a
  relaxed CSP only on preview deployments. Do not relax the production CSP for it.

## Test evidence (M10, local)

`node tools/preview-headers.mjs` serves `dist/` with exactly these headers (no SPA fallback, unknown paths 404, like a
Vercel static deploy). Headless Chrome, both locales, at 375x667:

- 0 `securitypolicyviolation` events, 0 CSP console messages, 0 blocked loads.
- Audio 206 and artwork 200 from `<MEDIA_ORIGIN>`; the Tibetan font, icons, grain and hero from self.
- Service worker installed and active with 12 precache entries; the page is controlled after a reload.
- One deliberate real presence connection (one tab, 3 s, closed): `wss://<SUPABASE_HOST>` handshake 101, badge showed
  a live count, 0 violations. Every other script stubs `WebSocket`.
- `curl`: `/`, `/index.html`, `/sw.js`, `/manifest.json` carry `no-cache`; `/assets/*` immutable; `/robots.txt`
  `text/plain`; the security headers are present on every response including 404s.
