// Writes public/artwork/artwork-192.jpg and artwork-512.jpg: the lock-screen (Media Session) artwork.
// Source: the user's Potala wallpaper (1024x1536), kept out of git under media/original/. See public/ASSETS.md.
// Needs ffmpeg on PATH (already required by the media pipeline). Run: node tools/make-artwork.mjs [source.png]
// JPEG, not PNG: at 512 px the PNG is about 512 KB (about 187 KB quantised), the JPEG about 56 KB.
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = process.argv[2] ?? fileURLToPath(new URL('../media/original/potoala_palace.png', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../public/artwork/', import.meta.url));
const CROP = 'crop=900:900:124:270'; // square around the palace, snow peaks included, foreground stupa cut
const SIZES = [192, 512];
const QUALITY = 5; // ffmpeg -q:v (2 best .. 31 worst)
const MAX_BYTES = 100 * 1024;

mkdirSync(OUT_DIR, { recursive: true });
let failed = false;
for (const size of SIZES) {
  const out = `${OUT_DIR}artwork-${size}.jpg`;
  const args = [
    '-v', 'error', '-y', '-i', SOURCE,
    '-vf', `${CROP},scale=${size}:${size}:flags=lanczos,format=yuvj420p`,
    '-q:v', String(QUALITY), '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact',
    out,
  ];
  const run = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (run.status !== 0) {
    console.error(`ffmpeg failed for ${size}px (exit ${run.status ?? 'none'})`);
    process.exit(1);
  }
  const bytes = statSync(out).size;
  console.log(`artwork-${size}.jpg ${bytes} bytes`);
  if (bytes >= MAX_BYTES) {
    console.error(`artwork-${size}.jpg is over the ${MAX_BYTES}-byte budget`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
