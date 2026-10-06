import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  parseEnvFile,
  planUploads,
  resolveBackendName,
  validateSupabaseUrl,
} from '../tools/upload-media';
import { ensureUploaded } from '../tools/storage/types';
import type { SourceConfig, TrackFacts } from '../tools/build-manifest';

const source: SourceConfig = {
  epoch: '2026-01-01T00:00:00Z',
  cdnBase: 'https://cdn.example.com',
  tracks: [
    {
      file: 'media/audio/a.m4a',
      art: 'media/art/a.jpg',
      title: { bo: 'ཀ', en: 'A' },
      artist: { bo: 'ཁ', en: 'B' },
    },
  ],
};

const facts = new Map<string, TrackFacts>([
  [
    'media/audio/a.m4a',
    {
      duration: 2,
      audioExists: true,
      artExists: true,
      audioHash: 'a1b2c3d4e5f6',
      artHash: '0f1e2d3c4b5a',
      audioExt: 'm4a',
      artExt: 'jpg',
    },
  ],
]);

describe('planUploads', () => {
  it('lists audio and artwork with keys matching the manifest URLs and correct content types', () => {
    const items = planUploads(source, facts, '/repo');
    expect(items).toEqual([
      {
        localPath: resolve('/repo', 'media/audio/a.m4a'),
        remoteKey: 'audio/a1b2c3d4e5f6.m4a',
        contentType: 'audio/mp4',
      },
      {
        localPath: resolve('/repo', 'media/art/a.jpg'),
        remoteKey: 'art/0f1e2d3c4b5a.jpg',
        contentType: 'image/jpeg',
      },
    ]);
  });
});

describe('planUploads → storage backend keys', () => {
  it('hands the backend bare bucket-relative keys (no leading slash, no full URL)', async () => {
    const [audio] = planUploads(source, facts, '/repo');
    if (!audio) throw new Error('expected an audio upload item');
    const upload = vi.fn().mockResolvedValue(undefined);
    const exists = vi.fn().mockResolvedValue(false);

    await ensureUploaded({ upload, exists }, audio.localPath, audio.remoteKey, audio.contentType);

    expect(exists).toHaveBeenCalledWith('audio/a1b2c3d4e5f6.m4a');
    expect(upload).toHaveBeenCalledWith(audio.localPath, 'audio/a1b2c3d4e5f6.m4a', 'audio/mp4');
    for (const [key] of upload.mock.calls) {
      expect(key).not.toMatch(/^\//);
      expect(key).not.toMatch(/^https?:\/\//);
    }
  });
});

describe('parseEnvFile', () => {
  it('reads KEY=VALUE pairs, skipping comments, blanks, and surrounding quotes', () => {
    const env = parseEnvFile(
      ['# comment', '', 'SUPABASE_URL=https://x.supabase.co', 'SUPABASE_SERVICE_ROLE_KEY="k"'].join(
        '\n',
      ),
    );
    expect(env).toEqual({
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
    });
  });
});

describe('resolveBackendName', () => {
  it('defaults to supabase', () => {
    expect(resolveBackendName({})).toBe('supabase');
  });

  it('accepts r2 when explicitly chosen', () => {
    expect(resolveBackendName({ STORAGE_BACKEND: 'r2' })).toBe('r2');
  });

  it('rejects unknown backends', () => {
    expect(() => resolveBackendName({ STORAGE_BACKEND: 's3' })).toThrow(
      'unknown STORAGE_BACKEND "s3" (expected supabase or r2)',
    );
  });
});

describe('validateSupabaseUrl', () => {
  it('accepts the bare project origin', () => {
    expect(validateSupabaseUrl('https://abcd.supabase.co')).toBe('https://abcd.supabase.co');
  });

  // Regression: a /rest/v1 suffix made every storage request 404 with
  // "Invalid path specified in request URL", and exists() misread that as "missing".
  it('rejects a /rest/v1 suffix before any request is made', () => {
    expect(() => validateSupabaseUrl('https://abcd.supabase.co/rest/v1/')).toThrow(/bare project origin/);
    expect(() => validateSupabaseUrl('https://abcd.supabase.co/rest/v1')).toThrow(/found path "\/rest\/v1"/);
  });

  it('rejects a trailing slash, query, http, and non-URLs', () => {
    expect(() => validateSupabaseUrl('https://abcd.supabase.co/')).toThrow(/trailing slash/);
    expect(() => validateSupabaseUrl('https://abcd.supabase.co?x=1')).toThrow(/bare project origin/);
    expect(() => validateSupabaseUrl('http://abcd.supabase.co')).toThrow(/https/);
    expect(() => validateSupabaseUrl('abcd.supabase.co')).toThrow(/not a valid URL/);
  });
});
