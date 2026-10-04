// Maps manifest facts to object keys and content types. Pure: shared by the manifest
// builder and upload-media.ts so both agree on where each file lives.
import type { TrackFacts } from './build-manifest';

const CONTENT_TYPES: Record<string, string> = {
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function contentTypeFor(ext: string): string {
  const type = CONTENT_TYPES[ext.toLowerCase()];
  if (!type) throw new Error(`unsupported media extension: .${ext}`);
  return type;
}

// Object keys relative to cdnBase; buildManifest appends these to cdnBase for src/artwork.
export function remoteKeys(facts: TrackFacts): { audio: string; art: string } {
  return {
    audio: `audio/${facts.audioHash}.${facts.audioExt}`,
    art: `art/${facts.artHash}.${facts.artExt}`,
  };
}
