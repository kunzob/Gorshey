import { describe, expect, it } from 'vitest';
import { parseSource } from '../tools/run-manifest';
import { contentTypeFor, remoteKeys } from '../tools/media-keys';

describe('parseSource', () => {
  it('parses a valid source YAML', () => {
    const src = parseSource(`epoch: "2026-01-01T00:00:00Z"
cdnBase: "https://cdn.example.com"
tracks:
  - file: media/audio/a.m4a
    art: media/art/a.jpg
    title: { bo: "ཀ", en: "A" }
    artist: { bo: "ཁ", en: "B" }
`);
    expect(src.cdnBase).toBe('https://cdn.example.com');
    expect(src.tracks).toHaveLength(1);
  });

  it('rejects a source without cdnBase', () => {
    expect(() => parseSource('epoch: "2026-01-01T00:00:00Z"\ntracks: []\n')).toThrow(/cdnBase/);
  });

  it('rejects tracks that is not a list', () => {
    expect(() =>
      parseSource('epoch: "2026-01-01T00:00:00Z"\ncdnBase: "https://x"\ntracks: nope\n'),
    ).toThrow(/tracks/);
  });
});

describe('media-keys', () => {
  it('maps extensions to content types', () => {
    expect(contentTypeFor('m4a')).toBe('audio/mp4');
    expect(contentTypeFor('JPG')).toBe('image/jpeg');
  });

  it('rejects unknown extensions', () => {
    expect(() => contentTypeFor('exe')).toThrow(/unsupported media extension/);
  });

  it('derives object keys that match the manifest URL paths', () => {
    const keys = remoteKeys({
      duration: 1,
      audioExists: true,
      artExists: true,
      audioHash: 'a1b2c3d4e5f6',
      artHash: '0f1e2d3c4b5a',
      audioExt: 'm4a',
      artExt: 'jpg',
    });
    expect(keys).toEqual({ audio: 'audio/a1b2c3d4e5f6.m4a', art: 'art/0f1e2d3c4b5a.jpg' });
  });
});
