import { describe, expect, it, vi } from 'vitest';
import { CACHE_CONTROL, createR2Backend, signAndSend } from '../tools/storage/r2';

const BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([9, 8, 7]);
const ENDPOINT = 'https://acct.r2.cloudflarestorage.com';

// Test seam only: the identity signer lets the fetch mock observe the built request.
// Production wiring uses signAndSend(), which is a stub (see the last test).
const identitySign = async (req: Request) => req;

describe('R2 request building (fetch mocked, no signing, no network)', () => {
  it('PUTs to <endpoint>/<bucket>/<key> with Content-Type and immutable Cache-Control', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const backend = createR2Backend({
      endpoint: ENDPOINT,
      bucket: 'gorshey-media',
      readFile: async () => BYTES,
      fetch: fetchMock as unknown as typeof fetch,
      sign: identitySign,
    });

    await backend.upload('media/audio/song1.m4a', 'audio/a1b2c3.m4a', 'audio/mp4');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = fetchMock.mock.calls[0]?.[0] as Request;
    expect(req.method).toBe('PUT');
    expect(req.url).toBe(`${ENDPOINT}/gorshey-media/audio/a1b2c3.m4a`);
    expect(req.headers.get('content-type')).toBe('audio/mp4');
    expect(req.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(CACHE_CONTROL).toBe('public, max-age=31536000, immutable');
  });

  it('throws when R2 answers with a non-2xx status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('denied', { status: 403 }));
    const backend = createR2Backend({
      endpoint: ENDPOINT,
      bucket: 'gorshey-media',
      readFile: async () => BYTES,
      fetch: fetchMock as unknown as typeof fetch,
      sign: identitySign,
    });

    await expect(backend.upload('f', 'audio/x.m4a', 'audio/mp4')).rejects.toThrow(
      'r2 upload failed for audio/x.m4a: HTTP 403',
    );
  });

  it('checks existence with HEAD: 200 → true, 404 → false', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const backend = createR2Backend({
      endpoint: ENDPOINT,
      bucket: 'gorshey-media',
      readFile: async () => BYTES,
      fetch: fetchMock as unknown as typeof fetch,
      sign: identitySign,
    });

    await expect(backend.exists('audio/a1b2c3.m4a')).resolves.toBe(true);
    await expect(backend.exists('audio/missing.m4a')).resolves.toBe(false);

    const first = fetchMock.mock.calls[0]?.[0] as Request;
    expect(first.method).toBe('HEAD');
    expect(first.url).toBe(`${ENDPOINT}/gorshey-media/audio/a1b2c3.m4a`);
  });

  it('production signing is not implemented and says where to implement it', async () => {
    await expect(signAndSend()).rejects.toThrow(
      'not implemented: R2 SigV4 signing (see ARCHITECTURE §0 — implement at migration time)',
    );
  });
});
