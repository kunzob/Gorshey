import { describe, expect, it, vi } from 'vitest';
import { loadManifest } from '../src/net/loadManifest';

const VALID = {
  version: '5166db301c24',
  epoch: '2026-01-01T00:00:00Z',
  totalDuration: 10,
  tracks: [
    {
      id: 'a',
      title: { bo: 'བོད', en: 'One' },
      artist: { bo: 'མིང་མེད', en: 'Unknown' },
      duration: 10,
      src: 'https://cdn.example/audio/a.mp3',
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('loadManifest', () => {
  it('fetches the URL and returns a parsed Manifest', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(VALID));
    const m = await loadManifest('/manifest.json', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/manifest.json', { cache: 'no-cache' });
    expect(m.epochMs).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(m.tracks).toHaveLength(1);
  });

  it('throws with the HTTP status on a non-OK response', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 503));
    await expect(loadManifest('/manifest.json', fetchFn)).rejects.toThrow(/HTTP 503/);
  });

  it('throws the validation error when the body is not a valid manifest', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ...VALID, epoch: 'nope' }));
    await expect(loadManifest('/manifest.json', fetchFn)).rejects.toThrow(/epoch/);
  });

  it('propagates network errors', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('offline');
    });
    await expect(loadManifest('/manifest.json', fetchFn)).rejects.toThrow(/offline/);
  });
});
