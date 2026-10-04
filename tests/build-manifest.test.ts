import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  validateTrack,
  type SourceConfig,
  type SourceTrack,
  type TrackFacts,
} from '../tools/build-manifest';

const goodTrack: SourceTrack = {
  file: 'media/audio/song1.m4a',
  art: 'media/art/song1.jpg',
  title: { bo: 'སྒྲོལ་མ།', en: 'Drolma' },
  artist: { bo: 'ཨ་ཁུ', en: 'Uncle' },
};

const goodFacts: TrackFacts = {
  duration: 214.37,
  audioExists: true,
  artExists: true,
  audioHash: 'a1b2c3d4e5f6',
  artHash: '0f1e2d3c4b5a',
  audioExt: 'm4a',
  artExt: 'jpg',
};

describe('validateTrack', () => {
  it('returns no errors for a valid track', () => {
    expect(validateTrack(goodTrack, goodFacts)).toEqual([]);
  });

  it('reports a missing bo title', () => {
    const t = { ...goodTrack, title: { en: 'Drolma' } };
    expect(validateTrack(t, goodFacts)).toContain('title.bo is missing');
  });

  it('reports a bo title with no Tibetan code points as a likely legacy encoding', () => {
    const t = { ...goodTrack, title: { bo: 'Drolma', en: 'Drolma' } };
    const errors = validateTrack(t, goodFacts);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/not Tibetan Unicode/);
    expect(errors[0]).toMatch(/legacy/);
  });

  it('reports zero duration', () => {
    expect(validateTrack(goodTrack, { ...goodFacts, duration: 0 })).toContain(
      'duration is zero or invalid for media/audio/song1.m4a',
    );
  });

  it('reports a missing audio file', () => {
    expect(validateTrack(goodTrack, { ...goodFacts, audioExists: false })).toContain(
      'audio file not found: media/audio/song1.m4a',
    );
  });

  it('reports a missing artwork file', () => {
    expect(validateTrack(goodTrack, { ...goodFacts, artExists: false })).toContain(
      'artwork file not found: media/art/song1.jpg',
    );
  });
});

describe('buildManifest', () => {
  const facts = new Map<string, TrackFacts>([[goodTrack.file, goodFacts]]);

  const config = (cdnBase: string, tracks: SourceTrack[] = [goodTrack]): SourceConfig => ({
    epoch: '2026-01-01T00:00:00Z',
    cdnBase,
    tracks,
  });

  it('outputs the ARCHITECTURE §8 schema with full URLs under cdnBase', () => {
    const m = buildManifest(config('https://cdn.example.com'), facts, '2026-10-04T00:00:00Z');
    expect(m).toEqual({
      version: '2026-10-04T00:00:00Z',
      epoch: '2026-01-01T00:00:00Z',
      totalDuration: 214.37,
      tracks: [
        {
          id: 'a1b2c3d4e5f6',
          title: { bo: 'སྒྲོལ་མ།', en: 'Drolma' },
          artist: { bo: 'ཨ་ཁུ', en: 'Uncle' },
          duration: 214.37,
          src: 'https://cdn.example.com/audio/a1b2c3d4e5f6.m4a',
          artwork: 'https://cdn.example.com/art/0f1e2d3c4b5a.jpg',
        },
      ],
    });
  });

  it('is identical across cdnBase values except for the URL prefix', () => {
    const a = buildManifest(config('https://a.example.com'), facts, 'v');
    const b = buildManifest(config('https://storage.example.org/bucket'), facts, 'v');
    const strip = (m: ReturnType<typeof buildManifest>) => ({
      ...m,
      tracks: m.tracks.map((t) => ({ ...t, src: '', artwork: '' })),
    });
    expect(strip(a)).toEqual(strip(b));
    expect(a.tracks[0]?.src).toBe('https://a.example.com/audio/a1b2c3d4e5f6.m4a');
    expect(b.tracks[0]?.src).toBe('https://storage.example.org/bucket/audio/a1b2c3d4e5f6.m4a');
  });

  it('sums measured float durations into totalDuration without rounding', () => {
    const second: SourceTrack = { ...goodTrack, file: 'media/audio/song2.m4a', art: 'media/art/song2.jpg' };
    const f2: TrackFacts = { ...goodFacts, duration: 100.005, audioHash: 'ffffffffffff' };
    const m = buildManifest(
      config('https://cdn.example.com', [goodTrack, second]),
      new Map([
        [goodTrack.file, goodFacts],
        [second.file, f2],
      ]),
      'v',
    );
    expect(m.totalDuration).toBeCloseTo(314.375, 10);
    expect(m.tracks[1]?.duration).toBe(100.005);
  });

  it('normalizes Tibetan strings before writing them', () => {
    // "ཀ" + three tsheg (U+0F0B ×3) + " ཁ", with surrounding whitespace.
    const messy: SourceTrack = {
      ...goodTrack,
      title: { bo: '  ཀ་་་ ཁ  ', en: 'K' },
    };
    const m = buildManifest(config('https://cdn.example.com', [messy]), facts, 'v');
    expect(m.tracks[0]?.title.bo).toBe('ཀ་ ཁ');
  });

  it('throws one error listing every validation failure', () => {
    const bad: SourceTrack = { ...goodTrack, title: { bo: 'Drolma' } };
    expect(() => buildManifest(config('https://cdn.example.com', [bad]), facts, 'v')).toThrow(
      /not Tibetan Unicode/,
    );
  });
});
