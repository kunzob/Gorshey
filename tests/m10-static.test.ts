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

describe('native UI follows the night theme (M10)', () => {
  it('declares color-scheme dark on :root, and light on the (disabled) light theme slot', () => {
    const tokens = readFileSync('src/styles/tokens.css', 'utf8');
    expect(tokens).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/);
    expect(tokens).toMatch(/:root\[data-theme="light"\]\s*\{[^}]*color-scheme:\s*light/);
  });
});

describe('player hidden until the first data is painted (M10)', () => {
  const css = readFileSync('src/styles/components.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('hides the player with visibility until <html data-player-ready>, with the same CSS-only fallback', () => {
    const rule = css.match(/html:not\(\[data-player-ready\]\) \.player\s*\{([^}]*)\}/);
    expect(rule, 'html:not([data-player-ready]) .player').not.toBeNull();
    expect(rule![1]).toMatch(/visibility:\s*hidden/);
    expect(rule![1]).not.toMatch(/display:/);
    expect(rule![1]).toMatch(/animation:\s*lang-ready-fallback 0s 6s forwards !important/);
  });

  it('noscript.css still shows the player at once without JS', () => {
    expect(readFileSync('public/noscript.css', 'utf8')).toMatch(/\.player\s*\{[^}]*visibility:\s*visible\s*!important/);
  });
});
