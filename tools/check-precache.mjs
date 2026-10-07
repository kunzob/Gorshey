// Fails the build if the service worker's precache list holds media or the track manifest, or misses the shell.
// Reads the list workbox injected into dist/sw.js and prints it. Run after vite build: node tools/check-precache.mjs dist
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Must be precached: the shell, the Tibetan font and its licence, and the web app manifest. */
export const REQUIRED_ENTRIES = [
  'index.html',
  'fonts/NotoSerifTibetan-tibetan-subset.woff2',
  'fonts/OFL.txt',
  'manifest.webmanifest',
];

// manifest.json is the TRACK manifest (network-first at runtime, never precached). Media never goes through the SW.
const FORBIDDEN = [/^manifest\.json$/, /^artwork\//, /^audio\//, /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i, /\.md$/i];

/** Entry URLs as injected by workbox-build (JSON.stringify output: "url":"..."). */
export function readPrecacheEntries(swSource) {
  return [...swSource.matchAll(/"url":"([^"]+)"/g)].map((m) => m[1]);
}

export function findForbidden(entries) {
  return entries.filter((e) => FORBIDDEN.some((re) => re.test(e)));
}

export function findMissing(entries) {
  return REQUIRED_ENTRIES.filter((r) => !entries.includes(r));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const entries = readPrecacheEntries(readFileSync(join(process.argv[2] ?? 'dist', 'sw.js'), 'utf8'));
  for (const e of entries) console.log(`precache ${e}`);
  const forbidden = findForbidden(entries);
  const missing = findMissing(entries);
  for (const f of forbidden) console.log(`FORBIDDEN in precache: ${f}`);
  for (const m of missing) console.log(`MISSING from precache: ${m}`);
  console.log(`${entries.length} precache entries, ${forbidden.length} forbidden, ${missing.length} missing`);
  process.exit(forbidden.length || missing.length || entries.length === 0 ? 1 : 0);
}
