// Security and cache headers for Gorshey, and a tiny static server that serves dist/ with them, so the CSP can be
// tested locally before M11 copies the same set into vercel.json. No dependencies.
//
//   node tools/preview-headers.mjs [port]        serve dist/ (default port 4330)
//   node tools/preview-headers.mjs --print       print the header set as a vercel.json "headers" array
//
// The external origins are DERIVED from the build, never typed in here (docs/SECURITY-HEADERS.md):
//   media + artwork origins  <- dist/manifest.json (track src / artwork URLs)
//   presence origin           <- process.env.VITE_SUPABASE_URL if set, else the *.supabase.co URL Vite baked into
//                                dist/assets/*.js. Nothing here reads .env files.
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const DIST = 'dist';

export function deriveOrigins(dist = DIST) {
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  const media = new Set(manifest.tracks.map((t) => new URL(t.src).origin));
  const art = new Set(manifest.tracks.filter((t) => t.artwork).map((t) => new URL(t.artwork).origin));
  let presence = new Set();
  if (process.env.VITE_SUPABASE_URL) {
    presence.add(new URL(process.env.VITE_SUPABASE_URL).origin);
  } else {
    for (const f of readdirSync(join(dist, 'assets')).filter((n) => n.endsWith('.js'))) {
      for (const m of readFileSync(join(dist, 'assets', f), 'utf8').matchAll(/https:\/\/[a-z0-9-]+\.supabase\.co/g)) presence.add(m[0]);
    }
  }
  return { media: [...media], artwork: [...art], presence: [...presence] };
}

export function contentSecurityPolicy({ media, artwork, presence }) {
  const wss = presence.map((o) => o.replace(/^https:/, 'wss:'));
  const directives = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
    'img-src': ["'self'", ...artwork],
    'media-src': [...media],
    'connect-src': ["'self'", ...presence, ...wss],
    'font-src': ["'self'"],
    'manifest-src': ["'self'"],
    'worker-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${[...new Set(v)].join(' ')}`)
    .join('; ');
}

// Features Gorshey never uses. Autoplay, fullscreen and media session are deliberately NOT listed.
const DENIED_FEATURES = [
  'accelerometer', 'bluetooth', 'browsing-topics', 'camera', 'display-capture', 'geolocation', 'gyroscope', 'hid',
  'magnetometer', 'microphone', 'midi', 'payment', 'publickey-credentials-get', 'serial', 'usb', 'xr-spatial-tracking',
];

/** The header set, shaped like vercel.json "headers": [{ source, headers: [{ key, value }] }]. Order matters on Vercel. */
export function headerRules(origins = deriveOrigins()) {
  const security = [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(origins) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: DENIED_FEATURES.map((f) => `${f}=()`).join(', ') },
  ];
  const noCache = [{ key: 'Cache-Control', value: 'no-cache' }];
  return [
    { source: '/(.*)', headers: security },
    { source: '/', headers: noCache },
    { source: '/index.html', headers: noCache },
    { source: '/sw.js', headers: noCache },
    { source: '/manifest.json', headers: noCache },
    { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
  ];
}

/** Headers for one path: later rules override earlier keys, as on Vercel. */
export function headersFor(path, rules) {
  const out = {};
  for (const r of rules) {
    const re = new RegExp(`^${r.source.replace(/\(\.\*\)/g, '.*')}$`);
    if (re.test(path)) for (const h of r.headers) out[h.key] = h.value;
  }
  return out;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

/** Static server for dist/ with the header set. Like a Vercel static deploy: no SPA fallback, unknown paths are 404. */
export function serve(port = 4330, dist = DIST) {
  const rules = headerRules(deriveOrigins(dist));
  const root = resolve(dist);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    let file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(400).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    const headers = headersFor(path, rules);
    if (!existsSync(file)) {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--print')) {
    console.log(JSON.stringify(headerRules(), null, 2));
  } else {
    const port = Number(process.argv[2] ?? 4330);
    await serve(port);
    console.log(`serving dist/ with security headers on http://127.0.0.1:${port}/`);
  }
}
