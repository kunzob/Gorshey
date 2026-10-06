import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/core/manifest';

// Copy of public/manifest.json as committed in M1. Hardcoded on purpose: adding or
// changing a track later must not silently change what these tests assert.
const REAL_MANIFEST = {
  version: '5166db301c24',
  epoch: '2026-01-01T00:00:00Z',
  totalDuration: 456.434688,
  tracks: [
    {
      id: 'bd4e9fd47041',
      title: { bo: 'མ་ནི་ཡིག་དྲུག', en: 'Song of Mani' },
      artist: { bo: 'མིང་མེད', en: 'Unknown' },
      duration: 211.255167,
      src: 'https://nfkubphegarcrznwjdlb.supabase.co/storage/v1/object/public/gorshey-media/audio/bd4e9fd47041.mp3',
      artwork:
        'https://nfkubphegarcrznwjdlb.supabase.co/storage/v1/object/public/gorshey-media/art/3782c52345aa.jpg',
    },
    {
      id: '283d75d6d29d',
      title: { bo: 'རྟེན་འབྲེལ་དགའ་བསྲུ།', en: 'Auspicious Welcome' },
      artist: { bo: 'མིང་མེད', en: 'Unknown' },
      duration: 245.179521,
      src: 'https://nfkubphegarcrznwjdlb.supabase.co/storage/v1/object/public/gorshey-media/audio/283d75d6d29d.mp3',
      artwork:
        'https://nfkubphegarcrznwjdlb.supabase.co/storage/v1/object/public/gorshey-media/art/3782c52345aa.jpg',
    },
  ],
};

type Json = Record<string, unknown>;

// Deep copy so each test can mutate freely.
function clone(): Json {
  return JSON.parse(JSON.stringify(REAL_MANIFEST)) as Json;
}

// Typed access to track i of a cloned manifest, for in-place mutation.
function track(raw: Json, i: number): Json {
  return (raw.tracks as Json[])[i] as Json;
}

describe('parseManifest: valid input', () => {
  it('accepts the real M1 manifest and returns a typed Manifest', () => {
    const m = parseManifest(clone());
    expect(m.version).toBe('5166db301c24');
    expect(m.epoch).toBe('2026-01-01T00:00:00Z');
    expect(m.epochMs).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(m.totalDuration).toBe(456.434688);
    expect(m.tracks.map((t) => t.duration)).toEqual([211.255167, 245.179521]);
    expect(m.tracks[0]?.title).toEqual({ bo: 'མ་ནི་ཡིག་དྲུག', en: 'Song of Mani' });
  });

  it('artwork is optional on a track', () => {
    const raw = clone();
    delete track(raw, 0).artwork;
    expect(() => parseManifest(raw)).not.toThrow();
  });

  it('accepts a single-track playlist whose total equals its one duration', () => {
    const raw = { ...clone(), totalDuration: 10, tracks: [{ ...track(clone(), 0), duration: 10 }] };
    expect(parseManifest(raw).totalDuration).toBe(10);
  });

  it('accepts a total that differs from the sum by less than 1 ms (0.0005 s)', () => {
    const raw = clone();
    raw.totalDuration = (raw.totalDuration as number) + 0.0005;
    expect(() => parseManifest(raw)).not.toThrow();
  });
});

describe('parseManifest: top-level shape', () => {
  it.each([
    ['null', null],
    ['a string', 'manifest'],
    ['an array', []],
    ['a number', 42],
  ])('rejects %s', (_label, value) => {
    expect(() => parseManifest(value)).toThrow(/manifest/i);
  });

  it('rejects a missing version', () => {
    const raw = clone();
    delete raw.version;
    expect(() => parseManifest(raw)).toThrow(/version/);
  });

  it('rejects an empty tracks array', () => {
    expect(() => parseManifest({ ...clone(), tracks: [], totalDuration: 0 })).toThrow(/tracks/);
  });

  it('rejects tracks that is not an array', () => {
    expect(() => parseManifest({ ...clone(), tracks: 'nope' })).toThrow(/tracks/);
  });

  it('rejects a track entry that is not an object', () => {
    const raw = clone();
    (raw.tracks as unknown[])[0] = 'bd4e9fd47041';
    expect(() => parseManifest(raw)).toThrow(/tracks\[0\]/);
  });
});

describe('parseManifest: epoch', () => {
  it('rejects an epoch that does not parse', () => {
    expect(() => parseManifest({ ...clone(), epoch: 'not-a-date' })).toThrow(/epoch/);
  });

  it('rejects a missing epoch', () => {
    const raw = clone();
    delete raw.epoch;
    expect(() => parseManifest(raw)).toThrow(/epoch/);
  });
});

describe('parseManifest: durations', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a numeric string', '211.2'],
  ])('rejects a track duration that is %s', (_label, bad) => {
    const raw = clone();
    track(raw, 1).duration = bad;
    expect(() => parseManifest(raw)).toThrow(/tracks\[1\]\.duration/);
  });

  it('error names the failing track index', () => {
    const raw = clone();
    track(raw, 0).duration = -5;
    expect(() => parseManifest(raw)).toThrow(/tracks\[0\]\.duration/);
  });

  it('rejects a total that is more than 1 ms over the sum', () => {
    const raw = clone();
    raw.totalDuration = (raw.totalDuration as number) + 0.002;
    expect(() => parseManifest(raw)).toThrow(/totalDuration/);
  });

  it('rejects a total that is more than 1 ms under the sum', () => {
    const raw = clone();
    raw.totalDuration = (raw.totalDuration as number) - 0.002;
    expect(() => parseManifest(raw)).toThrow(/totalDuration/);
  });

  it('rejects a non-finite totalDuration', () => {
    expect(() => parseManifest({ ...clone(), totalDuration: Number.NaN })).toThrow(/totalDuration/);
  });
});

describe('parseManifest: track fields', () => {
  it('rejects a track without an id', () => {
    const raw = clone();
    delete track(raw, 0).id;
    expect(() => parseManifest(raw)).toThrow(/tracks\[0\]\.id/);
  });

  it('rejects a title map missing the bo entry', () => {
    const raw = clone();
    delete (track(raw, 1).title as Json).bo;
    expect(() => parseManifest(raw)).toThrow(/tracks\[1\]\.title\.bo/);
  });

  it('rejects an artist map missing the en entry', () => {
    const raw = clone();
    delete (track(raw, 0).artist as Json).en;
    expect(() => parseManifest(raw)).toThrow(/tracks\[0\]\.artist\.en/);
  });

  it('rejects a title that is not a map', () => {
    const raw = clone();
    track(raw, 0).title = 'Song of Mani';
    expect(() => parseManifest(raw)).toThrow(/tracks\[0\]\.title/);
  });

  it('rejects a track without a src', () => {
    const raw = clone();
    delete track(raw, 0).src;
    expect(() => parseManifest(raw)).toThrow(/tracks\[0\]\.src/);
  });
});
