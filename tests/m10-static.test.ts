// M10 static checks for wiring and theme details that have no DOM or unit seam.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('boot fetches in parallel (M10)', () => {
  it('main.ts awaits the coarse clock offset and the track manifest together, not one after the other', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).toMatch(/Promise\.all\(\[\s*measureOffset\(\)[^\]]*loadManifestWithSource\(TRACK_MANIFEST_PATH\)/);
    expect(main).not.toMatch(/await measureOffset\(\)/);
  });
});
