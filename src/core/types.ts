export interface LocalizedText {
  bo: string;
  en: string;
}

export interface ManifestTrack {
  id: string;
  title: LocalizedText;
  artist: LocalizedText;
  /** Seconds, measured with ffprobe at build time. */
  duration: number;
  src: string;
  artwork?: string;
}

export interface Manifest {
  version: string;
  /** ISO-8601 UTC instant as written in the manifest. */
  epoch: string;
  /** `epoch` parsed to milliseconds since the Unix epoch. */
  epochMs: number;
  /** Seconds; equals the sum of track durations within 1 ms. */
  totalDuration: number;
  tracks: ManifestTrack[];
}

/** Anything that can report the corrected current time in ms (clock.now satisfies this). */
export interface Clock {
  now(): number;
}
