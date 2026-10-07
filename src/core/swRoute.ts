// Service-worker routing decisions, pure so they can be tested exhaustively. src/sw.ts only acts on them.
// Two different files are both called "manifest": keep them apart by name everywhere.

/** The track manifest: playlist, durations and epoch. Drives the sync; must never be served stale. */
export const TRACK_MANIFEST_PATH = '/manifest.json';
/** The web app manifest: install metadata (name, icons). Precached with the shell. */
export const WEB_APP_MANIFEST_PATH = '/manifest.webmanifest';
/** Runtime cache for the track manifest (network-first; read only when the network fails). */
export const TRACK_MANIFEST_CACHE = 'gorshey-track-manifest-v1';
/** Prefix of every runtime cache this app owns; older versions are deleted on activate. */
export const RUNTIME_CACHE_PREFIX = 'gorshey-';
/** Header the service worker adds when it answers the track manifest from its cache. */
export const CACHED_MANIFEST_HEADER = 'x-gorshey-manifest';
export const CACHED_MANIFEST_VALUE = 'cached';
/** The only message the service worker acts on: activate the waiting version (user clicked update). */
export const SKIP_WAITING = 'SKIP_WAITING';

export type SwRoute = 'bypass' | 'track-manifest' | 'shell' | 'precache';

export interface SwRequest {
  method: string;
  url: string;
  mode: string;
  /** Value of the Range header, or null. */
  range: string | null;
}

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i;

/** Audio and artwork never go through the service worker (invariant 5), wherever they are served from. */
export function isMediaPath(pathname: string): boolean {
  return pathname.startsWith('/artwork/') || pathname.startsWith('/audio/') || AUDIO_EXT.test(pathname);
}

/**
 * Order matters: every bypass rule comes first, so no later rule can capture media, Range or non-GET requests.
 * `isPrecached` receives the full URL.
 */
export function classifyRequest(req: SwRequest, origin: string, isPrecached: (url: string) => boolean): SwRoute {
  if (req.method !== 'GET') return 'bypass';
  const url = new URL(req.url);
  if (url.origin !== origin) return 'bypass';
  if (req.range !== null) return 'bypass';
  if (isMediaPath(url.pathname)) return 'bypass';
  if (url.pathname === TRACK_MANIFEST_PATH) return 'track-manifest';
  if (req.mode === 'navigate') return 'shell';
  if (isPrecached(req.url)) return 'precache';
  return 'bypass';
}

/** A copy of a cached track-manifest response, marked so the page knows it may be stale. */
export function markCached(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set(CACHED_MANIFEST_HEADER, CACHED_MANIFEST_VALUE);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
