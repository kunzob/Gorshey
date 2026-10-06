import { parseManifest } from '../core/manifest';
import type { Manifest } from '../core/types';

type FetchFn = (url: string, init: { cache: RequestCache }) => Promise<Response>;

/** Wiring-layer loader: the only place the manifest is fetched. Validation lives in core. */
export async function loadManifest(url: string, fetchFn: FetchFn = fetch): Promise<Manifest> {
  const res = await fetchFn(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Manifest request failed: HTTP ${res.status}`);
  return parseManifest(await res.json());
}
