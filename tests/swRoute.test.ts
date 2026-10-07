import { describe, expect, it } from 'vitest';
import {
  CACHED_MANIFEST_HEADER,
  CACHED_MANIFEST_VALUE,
  TRACK_MANIFEST_PATH,
  WEB_APP_MANIFEST_PATH,
  classifyRequest,
  isMediaPath,
  markCached,
  type SwRequest,
} from '../src/core/swRoute';

const ORIGIN = 'https://gorshey.app';
const PRECACHED = new Set([
  `${ORIGIN}/index.html`,
  `${ORIGIN}/assets/index-abc.js`,
  `${ORIGIN}/fonts/NotoSerifTibetan-tibetan-subset.woff2`,
  `${ORIGIN}/manifest.webmanifest`,
]);
const isPrecached = (url: string): boolean => PRECACHED.has(url);

function req(path: string, over: Partial<SwRequest> = {}): SwRequest {
  return { method: 'GET', url: path.startsWith('http') ? path : `${ORIGIN}${path}`, mode: 'cors', range: null, ...over };
}
const classify = (r: SwRequest) => classifyRequest(r, ORIGIN, isPrecached);

describe('swRoute: the two manifests have distinct paths', () => {
  it('track manifest is /manifest.json, web app manifest is /manifest.webmanifest', () => {
    expect(TRACK_MANIFEST_PATH).toBe('/manifest.json');
    expect(WEB_APP_MANIFEST_PATH).toBe('/manifest.webmanifest');
  });
});

describe('swRoute: bypass (never respondWith)', () => {
  it.each(['HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'])('%s on a same-origin precached URL', (method) => {
    expect(classify(req('/index.html', { method }))).toBe('bypass');
  });

  it('the clock HEAD to / and /?sync=3', () => {
    expect(classify(req('/', { method: 'HEAD' }))).toBe('bypass');
    expect(classify(req('/?sync=3', { method: 'HEAD' }))).toBe('bypass');
  });

  it('cross-origin GET: Supabase audio, artwork, realtime, a future R2 domain', () => {
    expect(classify(req('https://x.supabase.co/storage/v1/object/public/m/audio/a.mp3'))).toBe('bypass');
    expect(classify(req('https://x.supabase.co/storage/v1/object/public/m/art/a.jpg'))).toBe('bypass');
    expect(classify(req('https://x.supabase.co/realtime/v1/websocket'))).toBe('bypass');
    expect(classify(req('https://media.gorshey.app/audio/a.mp3'))).toBe('bypass');
  });

  it('cross-origin navigation', () => {
    expect(classify(req('https://example.com/', { mode: 'navigate' }))).toBe('bypass');
  });

  it('a Range request, even to a precached same-origin URL or the track manifest', () => {
    expect(classify(req('/assets/index-abc.js', { range: 'bytes=0-' }))).toBe('bypass');
    expect(classify(req(TRACK_MANIFEST_PATH, { range: 'bytes=0-99' }))).toBe('bypass');
  });

  it('same-origin /artwork/* (lock-screen art), even if it were precached', () => {
    const always = (): boolean => true;
    expect(classifyRequest(req('/artwork/artwork-512.jpg'), ORIGIN, always)).toBe('bypass');
    expect(classifyRequest(req('/artwork/artwork-192.jpg'), ORIGIN, always)).toBe('bypass');
  });

  it('same-origin /audio/* and audio extensions, any case', () => {
    for (const p of ['/audio/a', '/a.mp3', '/x/b.M4A', '/c.aac', '/d.ogg', '/e.opus', '/f.wav', '/g.FLAC']) {
      expect(classify(req(p))).toBe('bypass');
    }
  });

  it('a same-origin GET that is not precached and not a navigation', () => {
    expect(classify(req('/unknown.txt'))).toBe('bypass');
    expect(classify(req('/fonts/SOURCE.md'))).toBe('bypass');
  });
});

describe('swRoute: handled', () => {
  it('the track manifest, with or without a query string', () => {
    expect(classify(req('/manifest.json'))).toBe('track-manifest');
    expect(classify(req('/manifest.json?v=2'))).toBe('track-manifest');
  });

  it('the track manifest even when the browser marks it a navigation', () => {
    expect(classify(req('/manifest.json', { mode: 'navigate' }))).toBe('track-manifest');
  });

  it('the web app manifest is precache, not track-manifest', () => {
    expect(classify(req('/manifest.webmanifest'))).toBe('precache');
  });

  it('same-origin navigations get the shell', () => {
    expect(classify(req('/', { mode: 'navigate' }))).toBe('shell');
    expect(classify(req('/anything?x=1', { mode: 'navigate' }))).toBe('shell');
  });

  it('precached assets: hashed JS, the Tibetan font', () => {
    expect(classify(req('/assets/index-abc.js'))).toBe('precache');
    expect(classify(req('/fonts/NotoSerifTibetan-tibetan-subset.woff2'))).toBe('precache');
  });
});

describe('swRoute: isMediaPath', () => {
  it('true for artwork, audio and audio extensions; false for shell files', () => {
    expect(isMediaPath('/artwork/a.jpg')).toBe(true);
    expect(isMediaPath('/audio/x')).toBe(true);
    expect(isMediaPath('/a.opus')).toBe(true);
    expect(isMediaPath('/hero/hero-potala.svg')).toBe(false);
    expect(isMediaPath('/grain/grain.png')).toBe(false);
    expect(isMediaPath('/artworks.html')).toBe(false);
  });
});

describe('swRoute: markCached', () => {
  it('returns a copy with the cached-manifest header, body and status intact', async () => {
    const original = new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } });
    const marked = markCached(original);
    expect(marked.headers.get(CACHED_MANIFEST_HEADER)).toBe(CACHED_MANIFEST_VALUE);
    expect(marked.headers.get('content-type')).toBe('application/json');
    expect(marked.status).toBe(200);
    expect(await marked.text()).toBe('{"a":1}');
  });
});
