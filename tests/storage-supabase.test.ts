import { describe, expect, it, vi } from 'vitest';
import { createSupabaseBackend } from '../tools/storage/supabase';
import { ensureUploaded } from '../tools/storage/types';

const BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3]);

function fakeClient(overrides: {
  upload?: ReturnType<typeof vi.fn>;
  exists?: ReturnType<typeof vi.fn>;
} = {}) {
  const bucket = {
    upload: overrides.upload ?? vi.fn().mockResolvedValue({ data: {}, error: null }),
    exists: overrides.exists ?? vi.fn().mockResolvedValue({ data: false, error: null }),
  };
  const from = vi.fn().mockReturnValue(bucket);
  return { client: { storage: { from } } as never, from, bucket };
}

describe('createSupabaseBackend', () => {
  it('uploads to the gorshey-media bucket with contentType, 1-year cacheControl and upsert false', async () => {
    const { client, from, bucket } = fakeClient();
    const backend = createSupabaseBackend({
      client,
      bucket: 'gorshey-media',
      readFile: async () => BYTES,
    });

    await backend.upload('media/audio/song1.m4a', 'audio/a1b2c3.m4a', 'audio/mp4');

    expect(from).toHaveBeenCalledWith('gorshey-media');
    expect(bucket.upload).toHaveBeenCalledWith('audio/a1b2c3.m4a', BYTES, {
      contentType: 'audio/mp4',
      cacheControl: '31536000',
      upsert: false,
    });
  });

  it('throws with the Supabase error message when upload fails', async () => {
    const upload = vi.fn().mockResolvedValue({ data: null, error: { message: 'quota exceeded' } });
    const { client } = fakeClient({ upload });
    const backend = createSupabaseBackend({ client, bucket: 'gorshey-media', readFile: async () => BYTES });

    await expect(backend.upload('x', 'audio/x.m4a', 'audio/mp4')).rejects.toThrow(
      'supabase upload failed for audio/x.m4a: quota exceeded',
    );
  });

  it('reports existence from storage', async () => {
    const exists = vi.fn().mockResolvedValue({ data: true, error: null });
    const { client } = fakeClient({ exists });
    const backend = createSupabaseBackend({ client, bucket: 'gorshey-media', readFile: async () => BYTES });

    await expect(backend.exists('audio/a1b2c3.m4a')).resolves.toBe(true);
    expect(exists).toHaveBeenCalledWith('audio/a1b2c3.m4a');
  });
});

describe('ensureUploaded', () => {
  it('skips the upload when the object already exists', async () => {
    const upload = vi.fn();
    const backend = { upload, exists: vi.fn().mockResolvedValue(true) };

    await expect(ensureUploaded(backend, 'f', 'k', 'ct')).resolves.toBe('skipped');
    expect(upload).not.toHaveBeenCalled();
  });

  it('uploads when the object is missing', async () => {
    const upload = vi.fn().mockResolvedValue(undefined);
    const backend = { upload, exists: vi.fn().mockResolvedValue(false) };

    await expect(ensureUploaded(backend, 'f', 'k', 'ct')).resolves.toBe('uploaded');
    expect(upload).toHaveBeenCalledWith('f', 'k', 'ct');
  });
});
