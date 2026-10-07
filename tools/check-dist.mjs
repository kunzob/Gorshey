// Fails the build if any secret-looking string is in dist/. Run after vite build: node tools/check-dist.mjs dist
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PATTERNS = ['service_role', 'sb_secret', 'SUPABASE_SERVICE_ROLE_KEY', 'secret-key'];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function findSecrets(dir) {
  const hits = [];
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'latin1');
    for (const pattern of PATTERNS) {
      if (text.includes(pattern)) hits.push({ file, pattern });
    }
  }
  return hits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hits = findSecrets(process.argv[2] ?? 'dist');
  for (const h of hits) console.log(`SECRET-LIKE ${h.pattern} in ${h.file}`);
  console.log(`${hits.length} secret-like hit(s) in dist`);
  process.exit(hits.length ? 1 : 0);
}
