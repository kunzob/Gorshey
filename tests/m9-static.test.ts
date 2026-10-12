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
    // M10 F5: a zero-length animation whose keyframes only switch visibility is not motion (the boot fallback that
    // reveals the player if JS never runs); it must stay active under reduced motion, so it is exempt here.
    const visibilityOnly = (name: string): boolean => {
      const body = ALL_CSS.match(new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?\\})\\s*\\}`))?.[1] ?? '';
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      return props.length > 0 && props.every((p) => p === 'visibility');
    };
    const animated = RULES.filter((r) => {
      const a = decl(r.body, 'animation') ?? decl(r.body, 'animation-name');
      if (a === null || /^none\b/.test(a)) return false;
      const [name, duration] = a.split(/\s+/);
      return !(duration === '0s' && visibilityOnly(name!));
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

describe('no layout in the wrong language before JS (M10 F5, option C)', () => {
  const HIDDEN = 'html:not([data-lang-ready]) .player';

  it('the player is hidden with visibility (layout kept, nothing shifts) until <html data-lang-ready>', () => {
    const r = RULES.find((x) => x.selectors.includes(HIDDEN) && x.at.length === 0)!;
    expect(r, HIDDEN).toBeDefined();
    expect(decl(r.body, 'visibility')).toBe('hidden');
    expect(decl(r.body, 'display')).toBeNull();
  });

  it('a CSS-only fallback reveals it if JS never runs (zero-length visibility switch, not motion)', () => {
    const r = RULES.find((x) => x.selectors.includes(HIDDEN) && x.at.length === 0)!;
    expect(decl(r.body, 'animation')).toMatch(/^lang-ready-fallback 0s 6s forwards !important$/);
    expect(ALL_CSS).toMatch(/@keyframes\s+lang-ready-fallback\s*\{\s*to\s*\{\s*visibility:\s*visible;?\s*\}\s*\}/);
  });

  it('without JS a same-origin stylesheet in <noscript> shows the player (no inline style: CSP unchanged)', () => {
    expect(HTML).toMatch(/<noscript><link rel="stylesheet" href="\/noscript\.css" ?\/?><\/noscript>/);
    const css = readFileSync('public/noscript.css', 'utf8');
    expect(css).toMatch(/\.player\s*\{[^}]*visibility:\s*visible\s*!important/);
    expect(HTML).not.toMatch(/<style[\s>]/);
    expect(HTML.match(/<script/g)).toHaveLength(1); // only the module entry
  });
});

describe('the title box never changes height between tracks (M10 F14)', () => {
  // F14 repaints the title at boundaries while paused, and boots on whichever track is scheduled. A title that wraps
  // differently from track to track would shift the centred column, so the box is exactly two Tibetan lines.
  const own = (sel: string, media?: RegExp): Rule | undefined =>
    RULES.find((r) => r.selectors.length === 1 && r.selectors[0] === sel && (media ? r.at.some((a) => media.test(a)) : r.at.length === 0));

  it('the title reserves two Tibetan lines and clamps at two (gorshey-tibetan §2: min-height + line-clamp)', () => {
    const t = own('.title')!;
    expect(decl(t.body, 'min-height')).toBe('calc(2 * 1.9em)');
    expect(decl(t.body, 'display')).toBe('-webkit-box');
    expect(decl(t.body, '-webkit-line-clamp')).toBe('2');
    expect(decl(t.body, '-webkit-box-orient')).toBe('vertical');
    expect(decl(t.body, 'overflow')).toBe('hidden');
    expect(decl(t.body, 'height')).toBeNull();
  });

  it('short screens keep the two-line reservation (only the font size shrinks)', () => {
    const short = own('.title', /max-height:\s*700px/)!;
    expect(decl(short.body, 'font-size')).not.toBeNull();
    expect(decl(short.body, 'min-height')).toBeNull();
  });
});

describe('play/pause never resizes the strip (M10 F6)', () => {
  const own = (sel: string): Rule | undefined =>
    RULES.find((r) => r.selectors.length === 1 && r.selectors[0] === sel && r.at.length === 0);

  it('the position row reserves one line of its own line height (mono digits in en, 1.9 in bo)', () => {
    expect(decl(own('.position')!.body, 'min-height')).toBe('1lh');
  });

  it('the controls stack the button and its sizers in one grid cell, still centred with the 8 px gap', () => {
    const c = own('.controls')!;
    expect(decl(c.body, 'display')).toBe('grid');
    expect(decl(c.body, 'justify-content')).toBe('center');
    expect(decl(c.body, 'gap')).toBe('8px');
    const cell = RULES.find((r) => r.selectors.includes('.controls > *') && r.at.length === 0)!;
    expect(decl(cell.body, 'grid-area')).toBe('1 / 1');
  });

  it('sizers render each label in its own language font: font: inherit applies to the button only (M10 F6 follow-up)', () => {
    // `.play { font: inherit }` matched the sizer spans too and, at equal specificity and later in the cascade, beat
    // :lang(bo), so in en mode the Tibetan sizers fell back to a narrow font and the pill was 92 px instead of 140 px.
    expect(decl(own('.play')!.body, 'font')).toBeNull();
    expect(decl(own('.play')!.body, 'font-family')).toBeNull();
    expect(decl(own('button.play')!.body, 'font')).toBe('inherit');
  });

  it('sizers keep their box (visibility, not display) and never take a click', () => {
    const s = own('.play-sizer')!;
    expect(decl(s.body, 'visibility')).toBe('hidden');
    expect(decl(s.body, 'pointer-events')).toBe('none');
    expect(decl(s.body, 'display')).toBeNull();
  });
});

describe('visually hidden utility for announcements (M10 F8)', () => {
  it('.sr-only hides content visually but keeps it in the accessibility tree (no display:none or visibility)', () => {
    const r = RULES.find((x) => x.selectors.length === 1 && x.selectors[0] === '.sr-only' && x.at.length === 0)!;
    expect(r, '.sr-only rule').toBeDefined();
    expect(decl(r.body, 'position')).toBe('absolute');
    expect(decl(r.body, 'width')).toBe('1px');
    expect(decl(r.body, 'height')).toBe('1px');
    expect(decl(r.body, 'overflow')).toBe('hidden');
    expect(decl(r.body, 'clip-path')).toBe('inset(50%)');
    expect(decl(r.body, 'display')).toBeNull();
    expect(decl(r.body, 'visibility')).toBeNull();
  });

  it('the update button carries no aria-live in the markup; #status stays the one polite region', () => {
    expect(HTML).toMatch(/<button id="update"(?![^>]*aria-live)[^>]*>/);
    expect(HTML.match(/aria-live=/g)).toHaveLength(1);
  });
});

describe('kora ring starts empty before JS runs (M10 F7)', () => {
  // Without these defaults the skeleton draws the fill as a full gold circle until setRing() runs.
  const CIRCUMFERENCE = 2 * Math.PI * 45; // r=45 in index.html and KoraRing.ts

  it('.ring-fill declares a dash array and offset at least one circumference long, so no stroke shows', () => {
    const fill = RULES.find((r) => r.selectors.length === 1 && r.selectors[0] === '.ring-fill' && r.at.length === 0)!;
    const dash = Number(decl(fill.body, 'stroke-dasharray'));
    const offset = Number(decl(fill.body, 'stroke-dashoffset'));
    expect(dash).toBeGreaterThanOrEqual(CIRCUMFERENCE);
    expect(offset).toBe(dash);
  });

  it('the ring radius in the markup is the one the defaults were sized for', () => {
    expect(HTML).toMatch(/<circle id="ring-fill" class="ring-fill" cx="50" cy="50" r="45">/);
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
