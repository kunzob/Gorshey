// Pure manifest logic. No fs, no network, no knowledge of Supabase or R2:
// the caller supplies file facts (durations, hashes, existence) and cdnBase.
import { normalizeTibetan } from './tibetan-normalize';

export type LocalizedText = Record<string, string | undefined>;

export interface SourceTrack {
  file: string;
  art: string;
  title: LocalizedText;
  artist: LocalizedText;
}

export interface SourceConfig {
  epoch: string;
  cdnBase: string;
  tracks: SourceTrack[];
}

export interface TrackFacts {
  duration: number;
  audioExists: boolean;
  artExists: boolean;
  audioHash: string;
  artHash: string;
  audioExt: string;
  artExt: string;
}

export interface ManifestTrack {
  id: string;
  title: LocalizedText;
  artist: LocalizedText;
  duration: number;
  src: string;
  artwork: string;
}

export interface Manifest {
  version: string;
  epoch: string;
  totalDuration: number;
  tracks: ManifestTrack[];
}

const TIBETAN = /[ༀ-࿿]/;

export function validateTrack(track: SourceTrack, facts: TrackFacts): string[] {
  const errors: string[] = [];
  const bo = track.title.bo;

  if (bo === undefined || bo.trim() === '') {
    errors.push('title.bo is missing');
  } else if (!TIBETAN.test(bo)) {
    errors.push(
      `title.bo is not Tibetan Unicode (possible legacy encoding): "${bo}" in ${track.file}`,
    );
  }

  if (!Number.isFinite(facts.duration) || facts.duration <= 0) {
    errors.push(`duration is zero or invalid for ${track.file}`);
  }
  if (!facts.audioExists) {
    errors.push(`audio file not found: ${track.file}`);
  }
  if (!facts.artExists) {
    errors.push(`artwork file not found: ${track.art}`);
  }
  return errors;
}

function normalizeText(text: LocalizedText): LocalizedText {
  const out: LocalizedText = {};
  for (const [locale, value] of Object.entries(text)) {
    if (value === undefined) continue;
    out[locale] = locale === 'bo' ? normalizeTibetan(value) : value.trim();
  }
  return out;
}

export function buildManifest(
  config: SourceConfig,
  facts: ReadonlyMap<string, TrackFacts>,
  version: string,
): Manifest {
  const errors: string[] = [];
  const tracks: ManifestTrack[] = [];

  for (const source of config.tracks) {
    const f = facts.get(source.file);
    if (!f) {
      errors.push(`no file facts for ${source.file}`);
      continue;
    }
    const normalized: SourceTrack = {
      ...source,
      title: normalizeText(source.title),
      artist: normalizeText(source.artist),
    };
    const trackErrors = validateTrack(normalized, f);
    errors.push(...trackErrors);
    if (trackErrors.length > 0) continue;

    tracks.push({
      id: f.audioHash,
      title: normalized.title,
      artist: normalized.artist,
      duration: f.duration,
      src: `${config.cdnBase}/audio/${f.audioHash}.${f.audioExt}`,
      artwork: `${config.cdnBase}/art/${f.artHash}.${f.artExt}`,
    });
  }

  if (errors.length > 0) {
    throw new Error(`manifest validation failed:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    version,
    epoch: config.epoch,
    totalDuration: tracks.reduce((sum, t) => sum + t.duration, 0),
    tracks,
  };
}
