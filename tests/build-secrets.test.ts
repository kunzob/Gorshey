import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
