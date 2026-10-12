// Fails the build if the first page load is over budget. Run after vite build: node tools/check-budget.mjs dist
// Counts the page-load files only: index.html, the JS and CSS it references, the hero, the grain tile, the web app
// manifest, the track manifest, and a fixed reserve for the remote track artwork. Excluded: audio, the Tibetan font,
// and the service-worker install extras (sw.js, icons, OFL.txt). Text is counted at gzip -9; PNG/JPEG at raw size.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export const BUDGET_BYTES = 60 * 1024;
// The artwork lives on the media CDN, so the build cannot measure it. This reserve is the size a real cover may use.
export const ARTWORK_RESERVE_BYTES = 16 * 1024;

const FIXED = ['hero/hero-potala.svg', 'grain/grain.png', 'manifest.webmanifest', 'manifest.json'];
const COMPRESSED = /\.(png|jpe?g|webp|avif)$/i;

function referencedAssets(html) {
  const js = [...html.matchAll(/<script[^>]*\ssrc="\/([^"]+)"/g)].map((m) => m[1]);
  const css = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="\/([^"]+)"/g)].map((m) => m[1]);
  return [...js, ...css];
}

function sizeOf(dir, name) {
  let buf;
  try {
    buf = readFileSync(join(dir, name));
  } catch {
    throw new Error(`page-load file missing from ${dir}: ${name}`);
  }
  return COMPRESSED.test(name) ? buf.length : gzipSync(buf, { level: 9 }).length;
}

export function measurePageLoad(dir) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const names = ['index.html', ...referencedAssets(html), ...FIXED];
  const entries = names.map((name) => ({ name, bytes: sizeOf(dir, name) }));
  entries.push({ name: 'track artwork (reserve)', bytes: ARTWORK_RESERVE_BYTES });
  const total = entries.reduce((sum, e) => sum + e.bytes, 0);
  return { entries, total, limit: BUDGET_BYTES, ok: total <= BUDGET_BYTES };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = measurePageLoad(process.argv[2] ?? 'dist');
  for (const e of r.entries) console.log(`budget ${String(e.bytes).padStart(7)} B  ${e.name}`);
  const kb = (n) => (n / 1024).toFixed(1);
  console.log(`page-load total ${r.total} B (${kb(r.total)} KB) of ${r.limit} B (${kb(r.limit)} KB) budget: ${r.ok ? 'OK' : 'OVER'}`);
  process.exit(r.ok ? 0 : 1);
}
