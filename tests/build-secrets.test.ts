import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSecrets } from '../tools/check-dist.mjs';

describe('dist secret check (runs after npm run build)', () => {
  it('flags service_role, sb_secret and the service key name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'a.js'), 'const k="service_role_xyz"; const s="sb_secret_abc"; const n="SUPABASE_SERVICE_ROLE_KEY"; const d="secret-key";');
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    const hits = findSecrets(dir);
    expect(hits.map((h) => h.pattern).sort()).toEqual(['SUPABASE_SERVICE_ROLE_KEY', 'secret-key', 'sb_secret', 'service_role'].sort());
  });

  it('a clean dist (the publishable key is allowed) has no hits', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-'));
    writeFileSync(join(dir, 'index.html'), 'sb_publishable_ok and anon key only');
    expect(findSecrets(dir)).toEqual([]);
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('publishable');
  });
});

// Fake JWTs built here; none is a real key. The role sits inside the base64url payload, so no substring check sees it.
const b64url = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: Record<string, unknown>): string =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.${Buffer.from('fake-signature-for-tests').toString('base64url')}`;

function distWith(content: string, name = 'assets/a.js'): string {
  const dir = mkdtempSync(join(tmpdir(), 'dist-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, name), content);
  return dir;
}

describe('JWT payloads are decoded (M10 F4)', () => {
  it('a legacy service-role JWT fails the check', () => {
    const dir = distWith(`const key = "${jwt({ iss: 'supabase', ref: 'abc', role: 'service_role', iat: 1, exp: 2 })}";`);
    expect(findSecrets(dir).map((h) => h.pattern)).toEqual(['jwt role=service_role']);
  });

  it('an anon JWT is allowed (public by design)', () => {
    const dir = distWith(`const key = "${jwt({ iss: 'supabase', ref: 'abc', role: 'anon', iat: 1, exp: 2 })}";`);
    expect(findSecrets(dir)).toEqual([]);
  });

  it('a JWT inside a URL or JSON string is still decoded', () => {
    const token = jwt({ role: 'service_role' });
    const dir = distWith(`{"url":"https://x.supabase.co/rest/v1?apikey=${token}"}`, 'manifest.json');
    expect(findSecrets(dir).map((h) => h.pattern)).toEqual(['jwt role=service_role']);
  });

  it('JWT-looking text that does not decode is not a hit (no false positives)', () => {
    const dir = distWith('const s = "eyJnotbase64!!.eyJ%%%.sig";');
    expect(findSecrets(dir)).toEqual([]);
  });
});

describe('R2 / S3 credentials (M10 F4)', () => {
  it.each([
    ['R2_SECRET_ACCESS_KEY', 'const n = "R2_SECRET_ACCESS_KEY";'],
    ['R2_ACCESS_KEY_ID', 'const n = "R2_ACCESS_KEY_ID";'],
    ['AWS_SECRET_ACCESS_KEY', 'process.env.AWS_SECRET_ACCESS_KEY'],
    ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_TOKEN'],
    ['X-Amz-Credential', 'https://acc.r2.cloudflarestorage.com/b/a.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=abc'],
    ['X-Amz-Signature', 'https://acc.r2.cloudflarestorage.com/b/a.mp3?X-Amz-Signature=0123'],
  ])('%s is flagged', (pattern, content) => {
    expect(findSecrets(distWith(content)).map((h) => h.pattern)).toContain(pattern);
  });

  it('hex digests and ids are not flagged (font SHA-256 in SOURCE.md, manifest version, track ids)', () => {
    const hex64 = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef';
    const dir = distWith(`sha256: ${hex64}\nversion: 008149c96f81\nid: 0123456789abcdef0123456789abcdef`, 'SOURCE.md');
    expect(findSecrets(dir)).toEqual([]);
  });
});

describe('the check never prints a matched value (M10 F4)', () => {
  it('CLI output names the file and the pattern only', () => {
    const token = jwt({ role: 'service_role', marker: 'VALUE-MUST-NOT-PRINT' });
    const dir = distWith(`const k="${token}"; const s="sb_secret_VALUEMUSTNOTPRINT";`);
    let out = '';
    try {
      execFileSync(process.execPath, ['tools/check-dist.mjs', dir], { encoding: 'utf8' });
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? '');
    }
    expect(out).toMatch(/jwt role=service_role/);
    expect(out).toMatch(/sb_secret/);
    expect(out).not.toContain(token);
    expect(out).not.toContain(token.split('.')[1]!);
    expect(out).not.toContain('VALUEMUSTNOTPRINT');
    expect(out).not.toContain('VALUE-MUST-NOT-PRINT');
  });
});

describe('the real build (M10 F4)', () => {
  it.skipIf(!existsSync('dist/index.html'))('has zero hits: no false positives on the current dist', () => {
    expect(findSecrets('dist')).toEqual([]);
  });
});
