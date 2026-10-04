import { describe, expect, it } from 'vitest';
import { normalizeTibetan } from '../tools/tibetan-normalize';

const TSHEG = '་';
const SHAD = '།';
const NBSP_TSHEG = '༌';

describe('normalizeTibetan', () => {
  it('applies NFC so composition exclusions are decomposed', () => {
    // U+0F73 is a composition exclusion; NFC splits it into U+0F71 U+0F72.
    expect(normalizeTibetan('ཱི')).toBe('ཱི');
  });

  it('replaces deprecated U+0F77 with U+0FB2 U+0F71 U+0F80', () => {
    expect(normalizeTibetan('ཷ')).toBe('ྲཱྀ');
  });

  it('replaces deprecated U+0F79 with U+0FB3 U+0F71 U+0F80', () => {
    expect(normalizeTibetan('ཹ')).toBe('ླཱྀ');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeTibetan('  སྒྲོལ་མ།  ')).toBe('སྒྲོལ་མ།');
  });

  it('collapses repeated tsheg into one', () => {
    expect(normalizeTibetan(`ཀ${TSHEG}${TSHEG}ཁ`)).toBe(`ཀ${TSHEG}ཁ`);
    expect(normalizeTibetan(`ཀ${TSHEG}${TSHEG}${TSHEG}ཁ`)).toBe(`ཀ${TSHEG}ཁ`);
  });

  it('removes a tsheg directly before a shad', () => {
    expect(normalizeTibetan(`བདེ${TSHEG}${SHAD}`)).toBe(`བདེ${SHAD}`);
  });

  it('keeps non-breaking tsheg (U+0F0C) untouched', () => {
    expect(normalizeTibetan(`ཀ${NBSP_TSHEG}ཁ`)).toBe(`ཀ${NBSP_TSHEG}ཁ`);
  });

  it('is idempotent', () => {
    const once = normalizeTibetan(`  ཷ ཀ${TSHEG}${TSHEG}${SHAD} `);
    expect(normalizeTibetan(once)).toBe(once);
  });
});
