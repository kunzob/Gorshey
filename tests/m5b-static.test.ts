import { readFileSync, statSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};
const HTML = read('index.html');
const CSS = ['src/styles/tokens.css', 'src/styles/fonts.css', 'src/styles/base.css', 'src/styles/components.css']
  .map(read)
  .join('\n');
const BO = JSON.parse(read('src/i18n/catalogs/bo.json') || '{}') as Record<string, string>;
const EN = JSON.parse(read('src/i18n/catalogs/en.json') || '{}') as Record<string, string>;
const LATIN = /[A-Za-z]/;

describe('footer: catalog strings only, no placeholder or mantra in production markup', () => {
  it('index.html has no placeholder text, no mantra, and no "EST." copy', () => {
    expect(HTML).not.toMatch(/PLACEHOLDER/i);
    expect(HTML).not.toMatch(/ཨོཾ|ཧཱུྃ/);
    expect(HTML).not.toMatch(/EST\./);
  });

  it('no source file contains "EST." or the mantra', () => {
    for (const f of ['src/ui/render.ts', 'src/ui/view.ts', 'src/i18n/catalogs/en.json', 'src/i18n/catalogs/bo.json']) {
      const s = read(f);
      expect(s, f).not.toMatch(/EST\./);
      expect(s, f).not.toMatch(/ཨོཾ/);
    }
  });

  it('the footer line exists in both catalogs', () => {
    expect(EN['footer.line']).toBe('MARPO RI · 3,700 M · 1645');
    expect(BO['footer.line']).toMatch(/[ༀ-࿿]/);
  });

  it('the footer element exists in the skeleton', () => {
    expect(HTML).toMatch(/<footer[^>]*id="footer"/);
  });
});

describe('Tibetan mode: no Latin letters in UI strings (brand and track titles are exempt)', () => {
  // Keys whose visible text is a UI string. The toggle label is excluded on purpose: it names the other language.
  const UI_KEYS = [
    'player.live',
    'place.marpoRi',
    'eyebrow.line',
    'badge.listeners',
    'footer.line',
    'player.nextUp',
    'player.buffering',
    'player.error',
    'player.offline',
    'update.available',
    'list.separator',
    'player.play',
    'player.pause',
  ];

  it.each(UI_KEYS)('%s has no Latin letters in its bo value', (key) => {
    const raw = BO[key];
    expect(raw, key).toBeTypeOf('string');
    const visible = raw!.replace(/\{\w+\}/g, ''); // placeholder names are not visible text
    expect(LATIN.test(visible), `${key}: ${visible}`).toBe(false);
  });
});

describe('grain: a pre-rendered tile, no runtime filter', () => {
  it('the hero SVG has no feTurbulence or filter (the grain lives in the tile)', () => {
    const svg = read('public/hero/hero-potala.svg');
    expect(svg).not.toMatch(/feTurbulence|<filter/);
  });

  it('a small pre-rendered grain PNG exists and is under 20 KB', () => {
    expect(existsSync('public/grain/grain.png')).toBe(true);
    const bytes = readFileSync('public/grain/grain.png');
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(statSync('public/grain/grain.png').size).toBeLessThan(20_000);
  });

  it('the grain overlay is decorative and sits in the markup', () => {
    expect(HTML).toMatch(/<div class="grain"[^>]*aria-hidden="true"/);
    expect(CSS).toMatch(/\.grain\s*\{[^}]*background-image:\s*url\(['"]?\/grain\/grain\.png/);
  });

  it('no runtime SVG or canvas filter is applied anywhere in the styles', () => {
    expect(CSS).not.toMatch(/filter:\s*url\(/);
  });
});

describe('hero image slot', () => {
  it('the hero is one <img> slot pointing at public/hero, with a real file under 150 KB', () => {
    expect(HTML).toMatch(/<img[^>]*src="\/hero\/hero-potala\.svg"/);
    expect(existsSync('public/hero/hero-potala.svg')).toBe(true);
    expect(statSync('public/hero/hero-potala.svg').size).toBeLessThan(150_000);
  });

  it('the scrim sits between the hero and the text', () => {
    expect(CSS).toMatch(/\.scrim\s*\{[^}]*linear-gradient/);
  });
});

describe('play button: pill, one line, no fixed height', () => {
  const play = CSS.match(/\.play\s*\{[^}]*\}/)?.[0] ?? '';

  it('is a pill with nowrap', () => {
    expect(play).toMatch(/border-radius:\s*999px/);
    expect(play).toMatch(/white-space:\s*nowrap/);
  });

  it('has a 48 px minimum target and no fixed height', () => {
    expect(play).toMatch(/min-width:\s*48px/);
    expect(play).toMatch(/min-height:\s*48px/);
    expect(play).not.toMatch(/(^|[;\s{])height:\s*\d/);
  });
});

describe('invariants kept', () => {
  it('reduced motion still turns off transitions and animations', () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*transition:\s*none/);
  });

  it('the status line stays a polite live region and the ring stays aria-hidden', () => {
    expect(HTML).toMatch(/id="status"[^>]*aria-live="polite"/);
    expect(HTML).toMatch(/class="ring"[^>]*aria-hidden="true"/);
  });

  it('the mono stack is system monospace only, with no new font file', () => {
    expect(CSS).toMatch(/ui-monospace/);
    expect(CSS).not.toMatch(/Geist|JetBrains/);
  });
});
