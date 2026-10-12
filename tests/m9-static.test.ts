// M9 theme polish: static checks on index.html and the stylesheets. Visual quality stays a manual check.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HTML = readFileSync('index.html', 'utf8');
const CSS_FILES = ['src/styles/tokens.css', 'src/styles/fonts.css', 'src/styles/base.css', 'src/styles/components.css'];
const TIBETAN = /[ༀ-࿿]/;

interface Rule {
  selectors: string[];
  body: string;
  /** Enclosing at-rule preludes, outermost first (e.g. "@media (prefers-reduced-motion: no-preference)"). */
  at: string[];
}

/** Minimal CSS walker: style rules with their enclosing at-rules. @keyframes and @font-face bodies are skipped. */
function parseRules(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const walk = (text: string, at: string[]): void => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open === -1) return;
      const prelude = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const inner = text.slice(open + 1, j - 1);
      if (prelude.startsWith('@media') || prelude.startsWith('@supports')) walk(inner, [...at, prelude]);
      else if (!prelude.startsWith('@')) rules.push({ selectors: prelude.split(',').map((s) => s.trim()), body: inner, at });
      i = j;
    }
  };
  walk(src, []);
  return rules;
}

const RULES = CSS_FILES.flatMap((f) => parseRules(readFileSync(f, 'utf8')));
const ALL_CSS = CSS_FILES.map((f) => readFileSync(f, 'utf8')).join('\n');
const decl = (body: string, prop: string): string | null => {
  const m = body.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1]!.trim() : null;
};
const NO_MOTION_PREF = /prefers-reduced-motion:\s*no-preference/;

describe('index.html head (M9)', () => {
  it('links a favicon to an existing PNG icon (no /favicon.ico request needed)', () => {
    const link = HTML.match(/<link[^>]*rel="icon"[^>]*>/);
    expect(link, 'rel="icon" link').not.toBeNull();
    const href = link![0].match(/href="([^"]+)"/)![1]!;
    expect(href).toMatch(/^\/icons\/.+\.png$/);
    expect(existsSync(`public${href}`)).toBe(true);
    expect(link![0]).toMatch(/type="image\/png"/);
  });

  it('has one English meta description: a single sentence, no Tibetan, search-snippet length', () => {
    const metas = HTML.match(/<meta[^>]*name="description"[^>]*>/g) ?? [];
    expect(metas).toHaveLength(1);
    const content = metas[0]!.match(/content="([^"]+)"/)![1]!;
    expect(content).not.toMatch(TIBETAN);
    expect(content).toMatch(/^[A-Z].*\.$/);
    expect(content.slice(0, -1)).not.toMatch(/[.!?]\s/);
    expect(content.length).toBeGreaterThanOrEqual(50);
    expect(content.length).toBeLessThanOrEqual(160);
  });

  it('keeps the Tibetan font preload exactly as it is (Tibetan brand is on screen on every load)', () => {
    expect(HTML).toContain(
      '<link rel="preload" href="/fonts/NotoSerifTibetan-tibetan-subset.woff2" as="font" type="font/woff2" crossorigin>',
    );
  });
});

describe('artwork markup (M9)', () => {
  it('the ring image has width, height and async decoding, no lazy loading, and starts hidden', () => {
    const img = HTML.match(/<img[^>]*id="artwork"[^>]*>/)![0];
    expect(img).toMatch(/width="512"/);
    expect(img).toMatch(/height="512"/);
    expect(img).toMatch(/decoding="async"/);
    expect(img).not.toMatch(/loading=/);
    expect(img).toMatch(/\shidden/);
    expect(img).not.toMatch(/\ssrc=/);
  });

  it('nothing preloads artwork', () => {
    expect(HTML).not.toMatch(/rel="preload"[^>]*(artwork|\/art\/)/);
  });

  it('the image is positioned inside the fixed-size halo, so showing or hiding it cannot shift layout', () => {
    const art = RULES.find((r) => r.selectors.includes('.artwork') && r.at.length === 0)!;
    expect(decl(art.body, 'position')).toBe('absolute');
    const halo = RULES.find((r) => r.selectors.includes('.halo') && r.at.length === 0)!;
    expect(decl(halo.body, 'width')).not.toBeNull();
    expect(decl(halo.body, 'height')).not.toBeNull();
  });
});

describe('presence dot (M9)', () => {
  it('is gold only when live; the placeholder state keeps the static maroon dot', () => {
    const base = RULES.find((r) => r.selectors.includes('.dot') && r.at.length === 0)!;
    expect(decl(base.body, 'background')).toBe('var(--color-maroon)');
    expect(decl(base.body, 'animation')).toBeNull();
    const live = RULES.find((r) => r.selectors.includes('.dot[data-live]') && r.at.length === 0)!;
    expect(decl(live.body, 'background')).toBe('var(--color-gold)');
  });

  it('pulses only under prefers-reduced-motion: no-preference', () => {
    const animated = RULES.filter((r) => {
      const a = decl(r.body, 'animation') ?? decl(r.body, 'animation-name');
      return a !== null && !/^none\b/.test(a);
    });
    expect(animated.length).toBeGreaterThan(0);
    for (const r of animated) {
      expect(r.at.some((a) => NO_MOTION_PREF.test(a)), r.selectors.join(',')).toBe(true);
    }
    expect(animated.some((r) => r.selectors.includes('.dot[data-live]'))).toBe(true);
    expect(ALL_CSS).toMatch(/@keyframes\s+dot-pulse\s*\{/);
  });
});

describe('kora ring state (M9)', () => {
  it('the track is gold while active and dimmed when not; the fill rule is unchanged', () => {
    const track = RULES.find((r) => r.selectors.includes('.ring-track') && r.at.length === 0)!;
    const active = RULES.find((r) => r.selectors.includes('.halo[data-active] .ring-track') && r.at.length === 0)!;
    expect(decl(track.body, 'stroke')).not.toBe(decl(active.body, 'stroke'));
    expect(decl(active.body, 'stroke')).toMatch(/201,\s*162,\s*74/); // --color-gold #c9a24a
    const fill = RULES.find((r) => r.selectors.includes('.ring-fill') && r.at.length === 0)!;
    expect(decl(fill.body, 'stroke')).toBe('var(--color-gold)');
  });

  it('the colour change only transitions when motion is allowed', () => {
    for (const r of RULES.filter((x) => decl(x.body, 'transition') !== null && !/none/.test(decl(x.body, 'transition')!))) {
      expect(r.at.some((a) => NO_MOTION_PREF.test(a)), r.selectors.join(',')).toBe(true);
    }
  });
});

describe('boot-fill rows reserve their filled height (M9 CLS fix)', () => {
  // Measured in headless Chrome: with the track manifest paused, these rows were shorter than after it arrived, and the
  // vertically centred column moved. Every other row keeps its height between the placeholder and filled states.
  const TIBETAN_LH = Number(
    readFileSync('src/styles/base.css', 'utf8').match(/:lang\(bo\)\s*\{[^}]*line-height:\s*([\d.]+)/)![1],
  );
  // The row's own rule (single selector), not a grouped reset such as `.eyebrow, ..., .nextup { margin: 0 }`.
  const top = (sel: string): Rule =>
    RULES.find((r) => r.selectors.length === 1 && r.selectors[0] === sel && r.at.length === 0)!;

  it('the brand row reserves one Tibetan line (the brand always contains Tibetan)', () => {
    expect(decl(top('.station').body, 'min-height')).toBe(`${TIBETAN_LH}em`);
  });

  it('the next-up row reserves one Tibetan line at its own font size, in every layout', () => {
    expect(decl(top('.nextup').body, 'min-height')).toBe(`${TIBETAN_LH}em`);
    // The short-phone override changes font-size only; an em reservation follows it, so nothing overrides min-height.
    for (const r of RULES.filter((x) => x.selectors.includes('.nextup') && x.at.length > 0)) {
      expect(decl(r.body, 'min-height'), r.at.join(' ')).toBeNull();
    }
  });

  it('the footer reserves its padding plus one line of its own line height (mono in en, Tibetan 1.9 in bo)', () => {
    const footer = top('.footer');
    const pad = decl(footer.body, 'padding-top');
    expect(decl(footer.body, 'min-height')).toBe(`calc(${pad} + 1lh)`);
  });

  it('the Tibetan line height used for the reservations is the :lang(bo) one', () => {
    expect(TIBETAN_LH).toBeGreaterThanOrEqual(1.9);
  });
});

describe('Latin-only typography never reaches Tibetan text (M9)', () => {
  // Tibetan can appear in any element whose lang is bo, including elements that inherit it from <html lang="bo">.
  // So tracking and case transforms are allowed only on selectors scoped to :lang(en).
  const scopedToEn = (sel: string): boolean => sel.includes(':lang(en)');

  it('every text-transform other than none is scoped to :lang(en)', () => {
    for (const r of RULES) {
      const v = decl(r.body, 'text-transform');
      if (v === null || v === 'none') continue;
      for (const s of r.selectors) expect(scopedToEn(s), s).toBe(true);
    }
  });

  it('every letter-spacing other than normal is scoped to :lang(en)', () => {
    for (const r of RULES) {
      const v = decl(r.body, 'letter-spacing');
      if (v === null || v === 'normal') continue;
      for (const s of r.selectors) expect(scopedToEn(s), s).toBe(true);
    }
  });

  it('the monospace stack is only used on :lang(en) selectors or the digits-only clock', () => {
    for (const r of RULES) {
      const v = decl(r.body, 'font-family');
      if (v === null || !v.includes('var(--mono)')) continue;
      for (const s of r.selectors) expect(scopedToEn(s) || s === '.clock', s).toBe(true);
    }
  });

  it('.caps uppercases Latin only', () => {
    const caps = RULES.filter((r) => r.selectors.some((s) => s.startsWith('.caps')));
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.some((r) => decl(r.body, 'text-transform') === 'uppercase')).toBe(true);
  });

  it('the footer uses the caps class', () => {
    expect(HTML).toMatch(/<footer[^>]*class="[^"]*\bcaps\b[^"]*"[^>]*id="footer"|<footer[^>]*id="footer"[^>]*class="[^"]*\bcaps\b/);
  });
});
