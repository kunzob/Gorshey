import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHED_MANIFEST_HEADER, TRACK_MANIFEST_CACHE } from '../src/core/swRoute';

// The service worker is tested against a fake ServiceWorkerGlobalScope with workbox mocked.
// What this proves: which requests get respondWith and with what. What it cannot prove: real browser
// caching, Range/206 behaviour and update timing. Those are manual checks (see PROGRESS.md, M8).

const ORIGIN = 'https://gorshey.app';
const PRECACHED = new Set([`${ORIGIN}/index.html`, `${ORIGIN}/assets/index-abc.js`, `${ORIGIN}/manifest.webmanifest`]);

const wb = vi.hoisted(() => ({
  precache: vi.fn(),
  cleanupOutdatedCaches: vi.fn(),
  matchPrecache: vi.fn(async (url: string) => new Response(`precached:${url}`)),
  getCacheKeyForURL: vi.fn((url: string) => url),
  networkFirstOpts: [] as unknown[],
  handle: vi.fn(async () => new Response('network-first')),
}));

vi.mock('workbox-precaching', () => ({
  precache: wb.precache,
  cleanupOutdatedCaches: wb.cleanupOutdatedCaches,
  matchPrecache: wb.matchPrecache,
  getCacheKeyForURL: wb.getCacheKeyForURL,
}));
vi.mock('workbox-strategies', () => ({
  NetworkFirst: class {
    constructor(opts: unknown) {
      wb.networkFirstOpts.push(opts);
    }
    handle = wb.handle;
  },
}));

type Listener = (event: unknown) => void;

class FakeScope {
  listeners = new Map<string, Listener[]>();
  location = { origin: ORIGIN };
  skipWaiting = vi.fn(async () => {});
  clients = { claim: vi.fn(async () => {}) };
  __WB_MANIFEST = [{ url: 'index.html', revision: 'r1' }];
  addEventListener(type: string, cb: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }
  dispatch(type: string, event: unknown): void {
    for (const cb of this.listeners.get(type) ?? []) cb(event);
  }
}

interface FakeFetchEvent {
  request: { method: string; url: string; mode: string; headers: Headers };
  respondWith: ReturnType<typeof vi.fn>;
}

function fetchEvent(path: string, init: { method?: string; mode?: string; range?: string } = {}): FakeFetchEvent {
  const headers = new Headers();
  if (init.range) headers.set('range', init.range);
  return {
    request: {
      method: init.method ?? 'GET',
      url: path.startsWith('http') ? path : `${ORIGIN}${path}`,
      mode: init.mode ?? 'cors',
      headers,
    },
    respondWith: vi.fn(),
  };
}

let scope: FakeScope;
let cacheNames: string[];
const deleted: string[] = [];

beforeEach(async () => {
  vi.resetModules();
  wb.networkFirstOpts.length = 0;
  deleted.length = 0;
  wb.getCacheKeyForURL.mockImplementation((url: string) => (PRECACHED.has(url) ? url : undefined) as string);
  scope = new FakeScope();
  cacheNames = ['workbox-precache-v2-x', TRACK_MANIFEST_CACHE, 'gorshey-track-manifest-v0', 'other-app'];
  vi.stubGlobal('self', scope);
  vi.stubGlobal('caches', {
    keys: async () => cacheNames,
    delete: async (n: string) => {
      deleted.push(n);
      return true;
    },
  });
  const swPath = '../src/sw.ts'; // a non-literal path keeps sw.ts (WebWorker lib) out of the main tsc program
  await import(/* @vite-ignore */ swPath);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function send(e: FakeFetchEvent): FakeFetchEvent {
  scope.dispatch('fetch', e);
  return e;
}

describe('sw: precache setup', () => {
  it('precaches the injected list and cleans outdated precaches; registers no workbox fetch route', () => {
    expect(wb.precache).toHaveBeenCalledWith(scope.__WB_MANIFEST);
    expect(wb.cleanupOutdatedCaches).toHaveBeenCalled();
    expect(scope.listeners.get('fetch')).toHaveLength(1);
  });
});

describe('sw: never intercepted (no respondWith)', () => {
  it.each(['HEAD', 'POST'])('%s requests', (method) => {
    expect(send(fetchEvent('/index.html', { method })).respondWith).not.toHaveBeenCalled();
  });

  it('cross-origin audio and artwork', () => {
    expect(send(fetchEvent('https://x.supabase.co/storage/v1/object/public/m/audio/a.mp3')).respondWith).not.toHaveBeenCalled();
    expect(send(fetchEvent('https://x.supabase.co/storage/v1/object/public/m/art/a.jpg')).respondWith).not.toHaveBeenCalled();
  });

  it('Range requests, even on a precached URL', () => {
    expect(send(fetchEvent('/assets/index-abc.js', { range: 'bytes=0-' })).respondWith).not.toHaveBeenCalled();
  });

  it('same-origin /artwork/* and audio files', () => {
    expect(send(fetchEvent('/artwork/artwork-512.jpg')).respondWith).not.toHaveBeenCalled();
    expect(send(fetchEvent('/audio/a.mp3')).respondWith).not.toHaveBeenCalled();
  });

  it('unknown same-origin GETs that are not navigations', () => {
    expect(send(fetchEvent('/nothing.txt')).respondWith).not.toHaveBeenCalled();
  });
});

describe('sw: handled requests', () => {
  it('the track manifest goes through NetworkFirst', async () => {
    const e = send(fetchEvent('/manifest.json'));
    expect(e.respondWith).toHaveBeenCalledTimes(1);
    expect(wb.handle).toHaveBeenCalledTimes(1);
    expect(await ((await e.respondWith.mock.calls[0]![0]) as Response).text()).toBe('network-first');
  });

  it('NetworkFirst has its own cache, no timeout, and marks a cached fallback', async () => {
    const opts = wb.networkFirstOpts[0] as {
      cacheName: string;
      networkTimeoutSeconds?: number;
      plugins: Array<{ cachedResponseWillBeUsed: (p: { cachedResponse?: Response }) => Promise<Response | undefined> }>;
    };
    expect(opts.cacheName).toBe(TRACK_MANIFEST_CACHE);
    expect(opts.networkTimeoutSeconds).toBeUndefined();
    const plugin = opts.plugins[0]!;
    const marked = await plugin.cachedResponseWillBeUsed({ cachedResponse: new Response('{}') });
    expect(marked?.headers.get(CACHED_MANIFEST_HEADER)).toBe('cached');
    expect(await plugin.cachedResponseWillBeUsed({ cachedResponse: undefined })).toBeUndefined();
  });

  it('a same-origin navigation is answered with the precached /index.html', async () => {
    const e = send(fetchEvent('/', { mode: 'navigate' }));
    const res = (await e.respondWith.mock.calls[0]![0]) as Response;
    expect(wb.matchPrecache).toHaveBeenCalledWith('/index.html');
    expect(await res.text()).toBe('precached:/index.html');
  });

  it('a precached asset is answered from the precache', async () => {
    const e = send(fetchEvent('/assets/index-abc.js'));
    const res = (await e.respondWith.mock.calls[0]![0]) as Response;
    expect(await res.text()).toBe(`precached:${ORIGIN}/assets/index-abc.js`);
  });

  it('falls back to the network when the precache misses', async () => {
    wb.matchPrecache.mockResolvedValueOnce(undefined as unknown as Response);
    const fetchSpy = vi.fn(async () => new Response('from-network'));
    vi.stubGlobal('fetch', fetchSpy);
    const e = send(fetchEvent('/assets/index-abc.js'));
    const res = (await e.respondWith.mock.calls[0]![0]) as Response;
    expect(await res.text()).toBe('from-network');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('sw: lifecycle and updates', () => {
  it('install never calls skipWaiting, and nothing calls clients.claim', () => {
    scope.dispatch('install', { waitUntil: vi.fn() });
    scope.dispatch('activate', { waitUntil: vi.fn() });
    expect(scope.skipWaiting).not.toHaveBeenCalled();
    expect(scope.clients.claim).not.toHaveBeenCalled();
  });

  it('SKIP_WAITING message calls skipWaiting once', () => {
    scope.dispatch('message', { data: 'SKIP_WAITING' });
    expect(scope.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('other messages are ignored', () => {
    scope.dispatch('message', { data: 'skip_waiting' });
    scope.dispatch('message', { data: { type: 'SKIP_WAITING' } });
    scope.dispatch('message', { data: null });
    expect(scope.skipWaiting).not.toHaveBeenCalled();
  });

  it('activate deletes old gorshey runtime caches only', async () => {
    const waitUntil = vi.fn();
    scope.dispatch('activate', { waitUntil });
    await waitUntil.mock.calls[0]![0];
    expect(deleted).toEqual(['gorshey-track-manifest-v0']);
  });
});
