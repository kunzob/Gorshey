import type { LocalizedText, Manifest, ManifestTrack } from './types';

// Sums are in seconds; 1 ms tolerance absorbs float error across tracks.
const TOTAL_TOLERANCE_S = 0.001;

type Json = Record<string, unknown>;

function fail(path: string, problem: string): never {
  throw new Error(`Invalid manifest at ${path}: ${problem}`);
}

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(obj: Json, key: string, path: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) fail(`${path}.${key}`, 'must be a non-empty string');
  return v;
}

function requireLocalized(obj: Json, key: string, path: string): LocalizedText {
  const v = obj[key];
  const at = `${path}.${key}`;
  if (!isObject(v)) fail(at, 'must be an object with bo and en');
  return { bo: requireString(v, 'bo', at), en: requireString(v, 'en', at) };
}

function parseTrack(raw: unknown, path: string): ManifestTrack {
  if (!isObject(raw)) fail(path, 'must be an object');
  const duration = raw.duration;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    fail(`${path}.duration`, 'must be a positive finite number of seconds');
  }
  const track: ManifestTrack = {
    id: requireString(raw, 'id', path),
    title: requireLocalized(raw, 'title', path),
    artist: requireLocalized(raw, 'artist', path),
    duration,
    src: requireString(raw, 'src', path),
  };
  if (raw.artwork !== undefined) track.artwork = requireString(raw, 'artwork', path);
  return track;
}

/**
 * Validates untrusted JSON (e.g. the fetched manifest) and returns a typed Manifest.
 * Throws an Error naming the first offending field.
 */
export function parseManifest(input: unknown): Manifest {
  if (!isObject(input)) fail('(root)', 'must be an object');

  const version = requireString(input, 'version', 'manifest');

  const epoch = requireString(input, 'epoch', 'manifest');
  const epochMs = Date.parse(epoch);
  if (Number.isNaN(epochMs)) fail('manifest.epoch', 'must be a parseable ISO-8601 instant');

  if (!Array.isArray(input.tracks) || input.tracks.length === 0) {
    fail('manifest.tracks', 'must be a non-empty array');
  }
  const tracks = input.tracks.map((t, i) => parseTrack(t, `tracks[${i}]`));
  const seen = new Set<string>();
  tracks.forEach((t, i) => {
    if (seen.has(t.id)) fail(`tracks[${i}].id`, `duplicate id "${t.id}"`);
    seen.add(t.id);
  });

  const totalDuration = input.totalDuration;
  if (typeof totalDuration !== 'number' || !Number.isFinite(totalDuration)) {
    fail('manifest.totalDuration', 'must be a finite number of seconds');
  }
  const sum = tracks.reduce((acc, t) => acc + t.duration, 0);
  if (Math.abs(totalDuration - sum) > TOTAL_TOLERANCE_S) {
    fail(
      'manifest.totalDuration',
      `is ${totalDuration}, but the track durations sum to ${sum} (more than 1 ms apart)`,
    );
  }

  return { version, epoch, epochMs, totalDuration, tracks };
}
