// Cloudflare R2 backend (migration path). Written and tested now, not run until migration.
// Requests are built with plain fetch semantics; SigV4 signing is deliberately unimplemented.
import { type ReadFile, type StorageBackend } from './types';

export const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export type Signer = (req: Request) => Promise<Request>;

export interface R2BackendOptions {
  endpoint: string; // e.g. https://<account>.r2.cloudflarestorage.com
  bucket: string;
  readFile: ReadFile;
  fetch?: typeof fetch;
  // Production leaves this unset, so every request goes through signAndSend() and fails.
  sign?: Signer;
}

function objectUrl(endpoint: string, bucket: string, key: string): string {
  return `${endpoint.replace(/\/+$/, '')}/${bucket}/${key}`;
}

export function buildPutRequest(
  endpoint: string,
  bucket: string,
  key: string,
  contentType: string,
  body: Uint8Array<ArrayBuffer>,
): Request {
  return new Request(objectUrl(endpoint, bucket, key), {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Cache-Control': CACHE_CONTROL,
    },
    body,
  });
}

export function buildHeadRequest(endpoint: string, bucket: string, key: string): Request {
  return new Request(objectUrl(endpoint, bucket, key), { method: 'HEAD' });
}

export async function signAndSend(): Promise<Request> {
  throw new Error(
    'not implemented: R2 SigV4 signing (see ARCHITECTURE §0 — implement at migration time)',
  );
}

export function createR2Backend(opts: R2BackendOptions): StorageBackend {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const sign = opts.sign ?? signAndSend;

  return {
    async upload(localPath, remoteKey, contentType) {
      const body = await opts.readFile(localPath);
      const req = buildPutRequest(opts.endpoint, opts.bucket, remoteKey, contentType, body);
      const res = await fetchImpl(await sign(req));
      if (!res.ok) {
        throw new Error(`r2 upload failed for ${remoteKey}: HTTP ${res.status}`);
      }
    },

    async exists(remoteKey) {
      const req = buildHeadRequest(opts.endpoint, opts.bucket, remoteKey);
      const res = await fetchImpl(await sign(req));
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      throw new Error(`r2 exists check failed for ${remoteKey}: HTTP ${res.status}`);
    },
  };
}
