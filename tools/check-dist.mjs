// Fails the build if any secret-looking string is in dist/. Run after vite build: node tools/check-dist.mjs dist
// Reports file and pattern NAME only; a matched value is never printed or returned.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Literal markers. The R2/S3 names and presigned-URL parameters cover credentials that have no fixed value shape
// (a bare 64-hex R2 secret looks exactly like the SHA-256 digests in fonts/SOURCE.md, so it is not matched by shape).
const PATTERNS = [
  'service_role',
  'sb_secret',
  'SUPABASE_SERVICE_ROLE_KEY',
  'secret-key',
  'R2_SECRET_ACCESS_KEY',
  'R2_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'CLOUDFLARE_API_TOKEN',
  'X-Amz-Credential',
  'X-Amz-Signature',
];

// A JWT: three base64url segments, the first two starting with eyJ ('{"'). Supabase legacy keys are JWTs whose role
// (anon or service_role) is inside the payload, where no substring check can see it.
const JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function jwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null; // not a decodable JWT: not a hit
  }
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Returns [{ file, pattern }]: pattern is a NAME (e.g. "jwt role=service_role"), never the matched text. */
export function findSecrets(dir) {
  const hits = [];
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'latin1');
    for (const pattern of PATTERNS) {
      if (text.includes(pattern)) hits.push({ file, pattern });
    }
    for (const m of text.matchAll(JWT)) {
      if (jwtRole(m[0]) === 'service_role') {
        hits.push({ file, pattern: 'jwt role=service_role' });
        break;
      }
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
