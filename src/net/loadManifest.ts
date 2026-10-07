import { parseManifest } from '../core/manifest';
import { CACHED_MANIFEST_HEADER, CACHED_MANIFEST_VALUE } from '../core/swRoute';
import type { Manifest } from '../core/types';

type FetchFn = (url: string, init: { cache: RequestCache }) => Promise<Response>;

/** Wiring-layer loader: the only place the track manifest is fetched. Validation lives in core. */
export async function loadManifest(url: string, fetchFn: FetchFn = fetch): Promise<Manifest> {
  return (await loadManifestWithSource(url, fetchFn)).manifest;
}

/**
 * Same, plus whether the service worker answered from its cache (it does so only when the network failed).
 * A cached track manifest may be stale, so the page fetches a fresh one once it is back online.
 */
export async function loadManifestWithSource(
  url: string,
  fetchFn: FetchFn = fetch,
): Promise<{ manifest: Manifest; fromCache: boolean }> {
  const res = await fetchFn(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Manifest request failed: HTTP ${res.status}`);
  const fromCache = res.headers.get(CACHED_MANIFEST_HEADER) === CACHED_MANIFEST_VALUE;
  return { manifest: parseManifest(await res.json()), fromCache };
}
