# M11 — Deploy

**Goal:** production on Vercel with correct headers and a custom domain.
**Skills:** `cloudflare` (DNS / R2 domain), `differential-review` (final diff).

## Files
`vercel.json`, `docs/DEPLOY.md`

## vercel.json (agent writes)
- Headers: `/index.html` and `/sw.js` → `Cache-Control: no-cache`; `/assets/(.*)` → `public, max-age=31536000, immutable`;
  `/manifest.json` → `no-cache`.
- Security headers on all routes: `Content-Security-Policy` (default-src 'self'; media-src and img-src add the R2 domain;
  connect-src adds `https://<project>.supabase.co` and `wss://<project>.supabase.co`; font-src 'self';
  frame-ancestors 'none'), `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`,
  `Permissions-Policy` disabling camera/microphone/geolocation.
- The R2 and Supabase hosts come from build-time env, documented in `docs/DEPLOY.md`.

## [HUMAN] Steps
1. Import the GitHub repo in Vercel; framework preset "Vite"; set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
2. Deploy preview; run the M10 smoke checks against the preview URL.
3. Add the custom domain; confirm HTTPS; confirm R2 custom domain for media.
4. Promote to production. Install the PWA on your phone from the production URL.

## Acceptance
- securityheaders-style check shows CSP and the other headers present; no CSP violations in the console.
- Production plays in sync on two devices; presence count works.
