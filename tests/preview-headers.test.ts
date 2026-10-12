// M10: the header set that M11 copies into vercel.json, and the local server that serves dist/ with it.
// Written after tools/preview-headers.mjs (not red-first); see PROGRESS.md M10.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contentSecurityPolicy, deriveOrigins, headerRules, headersFor, serve } from '../tools/preview-headers.mjs';

let dist: string;
const MEDIA = 'https://media-host.supabase.co';
const ART = 'https://art-host.example.com';
const PRESENCE = 'https://presence-host.supabase.co';

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'headers-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(
    join(dist, 'manifest.json'),
    JSON.stringify({ tracks: [{ src: `${MEDIA}/a.mp3`, artwork: `${ART}/a.jpg` }, { src: `${MEDIA}/b.mp3` }] }),
  );
  writeFileSync(join(dist, 'assets', 'index-abc.js'), `const u="${PRESENCE}";`);
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title>');
  delete process.env.VITE_SUPABASE_URL;
});
afterEach(() => {
  rmSync(dist, { recursive: true, force: true });
  delete process.env.VITE_SUPABASE_URL;
});

describe('origins are derived from the build, never hard-coded', () => {
  it('media and artwork come from the track manifest; presence from the URL baked into the bundle', () => {
    expect(deriveOrigins(dist)).toEqual({ media: [MEDIA], artwork: [ART], presence: [PRESENCE] });
  });

  it('VITE_SUPABASE_URL in the process environment wins over the bundle scan', () => {
    process.env.VITE_SUPABASE_URL = 'https://from-env.supabase.co/';
    expect(deriveOrigins(dist).presence).toEqual(['https://from-env.supabase.co']);
  });
});

describe('Content-Security-Policy', () => {
  const csp = (): string => contentSecurityPolicy(deriveOrigins(dist));

  it('scripts and styles are self only: no unsafe-inline, no unsafe-eval, no data: or blob:', () => {
    expect(csp()).toMatch(/script-src 'self';/);
    expect(csp()).toMatch(/style-src 'self';/);
    expect(csp()).not.toMatch(/unsafe-inline|unsafe-eval|data:|blob:|\*/);
  });

  it('media only from the media origin, images from self and the artwork origin', () => {
    expect(csp()).toContain(`media-src ${MEDIA};`);
    expect(csp()).toContain(`img-src 'self' ${ART};`);
  });

  it('connect-src allows self plus https and wss for the presence origin only', () => {
    expect(csp()).toContain(`connect-src 'self' ${PRESENCE} wss://presence-host.supabase.co;`);
  });

  it('locks down everything else', () => {
    for (const d of ["object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "worker-src 'self'", "font-src 'self'", "manifest-src 'self'"]) {
      expect(csp()).toContain(d);
    }
  });
});

describe('header rules', () => {
  const rules = (): ReturnType<typeof headerRules> => headerRules(deriveOrigins(dist));

  it('every path gets the security headers', () => {
    for (const p of ['/', '/index.html', '/sw.js', '/assets/index-abc.js', '/robots.txt', '/nope']) {
      const h = headersFor(p, rules());
      expect(Object.keys(h)).toEqual(
        expect.arrayContaining(['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']),
      );
      expect(h['X-Content-Type-Options']).toBe('nosniff');
      expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    }
  });

  it('Permissions-Policy never disables autoplay, fullscreen or media session', () => {
    const pp = headersFor('/', rules())['Permissions-Policy']!;
    expect(pp).not.toMatch(/autoplay|fullscreen|media-session|picture-in-picture/);
    expect(pp).toMatch(/camera=\(\)/);
    expect(pp).toMatch(/microphone=\(\)/);
  });

  it('the shell, the service worker and the track manifest are no-cache; hashed assets are immutable', () => {
    for (const p of ['/', '/index.html', '/sw.js', '/manifest.json']) expect(headersFor(p, rules())['Cache-Control'], p).toBe('no-cache');
    expect(headersFor('/assets/index-abc.js', rules())['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect(headersFor('/manifest.webmanifest', rules())['Cache-Control']).toBeUndefined();
  });
});

describe('local server', () => {
  it('serves files with the headers, 404s unknown paths (no SPA fallback) and refuses path traversal', async () => {
    const server = await serve(4399, dist);
    try {
      const ok = await fetch('http://127.0.0.1:4399/');
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-security-policy')).toContain("script-src 'self'");
      expect(ok.headers.get('cache-control')).toBe('no-cache');
      const missing = await fetch('http://127.0.0.1:4399/robots.txt');
      expect(missing.status).toBe(404);
      expect(await missing.text()).not.toMatch(/<!doctype/i);
      const traversal = await fetch('http://127.0.0.1:4399/..%2f..%2fpackage.json');
      expect([400, 404]).toContain(traversal.status);
    } finally {
      server.close();
    }
  });
});
