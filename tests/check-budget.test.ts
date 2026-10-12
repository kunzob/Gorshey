import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARTWORK_RESERVE_BYTES, BUDGET_BYTES, measurePageLoad } from '../tools/check-budget.mjs';

let dir: string;

function fixture(jsBytes: number): void {
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'hero'));
  mkdirSync(join(dir, 'grain'));
  writeFileSync(
    join(dir, 'index.html'),
    '<link rel="manifest" href="/manifest.webmanifest" />' +
      '<script type="module" crossorigin src="/assets/index-abc.js"></script>' +
      '<link rel="stylesheet" crossorigin href="/assets/index-abc.css">',
  );
  // Random bytes do not compress, so the gzip size tracks the raw size.
  writeFileSync(join(dir, 'assets/index-abc.js'), randomBytes(jsBytes));
  writeFileSync(join(dir, 'assets/index-abc.css'), 'a{color:red}');
  writeFileSync(join(dir, 'hero/hero-potala.svg'), '<svg/>');
  writeFileSync(join(dir, 'grain/grain.png'), Buffer.alloc(100, 1));
  writeFileSync(join(dir, 'manifest.webmanifest'), '{}');
  writeFileSync(join(dir, 'manifest.json'), '{}');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'budget-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('check-budget', () => {
  it('counts exactly the page-load files: html, the JS and CSS it references, hero, grain, both manifests, artwork', () => {
    fixture(1000);
    const r = measurePageLoad(dir);
    expect(r.entries.map((e: { name: string }) => e.name)).toEqual([
      'index.html',
      'assets/index-abc.js',
      'assets/index-abc.css',
      'hero/hero-potala.svg',
      'grain/grain.png',
      'manifest.webmanifest',
      'manifest.json',
      'track artwork (reserve)',
    ]);
    expect(r.total).toBe(r.entries.reduce((s: number, e: { bytes: number }) => s + e.bytes, 0));
  });

  it('PNG is counted at raw size (already compressed), text at gzip -9 size', () => {
    fixture(1000);
    const r = measurePageLoad(dir);
    const grain = r.entries.find((e: { name: string }) => e.name === 'grain/grain.png');
    expect(grain!.bytes).toBe(100);
    const css = r.entries.find((e: { name: string }) => e.name === 'assets/index-abc.css');
    expect(css!.bytes).toBeGreaterThan(0);
  });

  it('reserves a fixed allowance for the remote track artwork', () => {
    fixture(1000);
    const art = measurePageLoad(dir).entries.at(-1);
    expect(art!.bytes).toBe(ARTWORK_RESERVE_BYTES);
  });

  it('passes under the budget and fails over it', () => {
    fixture(1000);
    expect(measurePageLoad(dir).ok).toBe(true);
    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), 'budget-'));
    fixture(BUDGET_BYTES);
    expect(measurePageLoad(dir).ok).toBe(false);
  });

  it('a missing page-load file is an error, not a zero', () => {
    fixture(1000);
    rmSync(join(dir, 'grain/grain.png'));
    expect(() => measurePageLoad(dir)).toThrow(/grain\/grain\.png/);
  });

  it('the budget is 60 KB', () => {
    expect(BUDGET_BYTES).toBe(60 * 1024);
  });
});
