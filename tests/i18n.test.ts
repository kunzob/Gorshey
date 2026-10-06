import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALES, type Locale } from '../src/i18n/locales';
import {
  brandParts,
  createI18n,
  detectLocale,
  formatDuration,
  formatNumber,
  formatTime,
  pick,
  setLocale,
  t,
  titleParts,
  type Catalog,
} from '../src/i18n/i18n';
import { unreviewedKeys } from '../tools/i18n-review';

// Catalogs are read from disk so these tests run before the catalogs themselves exist (red run).
// A missing file reads as empty, so each test fails on its own assertion instead of the whole file failing.
const readJson = (path: string): Record<string, unknown> => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
};
const EN = readJson('src/i18n/catalogs/en.json');
const BO = readJson('src/i18n/catalogs/bo.json');
const REVIEW = readJson('src/i18n/catalogs/bo.review.json') as { reviewed?: string[] };

// Every text form of a catalog value (a string, or each plural form).
function forms(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Object.values(value as Record<string, string>);
}
const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
const TIBETAN_DIGIT = /[༠-༩]/;
const TIBETAN = /[ༀ-࿿]/;

// Real manifest titles, verbatim (public/manifest.json, M1).
const TITLE_1 = { bo: 'མ་ནི་ཡིག་དྲུག', en: 'Song of Mani' };
const TITLE_2 = { bo: 'རྟེན་འབྲེལ་དགའ་བསྲུ།', en: 'Auspicious Welcome' };

// ---- catalogs -----------------------------------------------------------------------------------

describe('catalogs', () => {
  it('bo and en have identical key sets, and every key exists in both', () => {
    expect(Object.keys(BO).sort()).toEqual(Object.keys(EN).sort());
    expect(Object.keys(EN).length).toBeGreaterThan(0);
  });

  it('every key uses the same {placeholders} in bo and en', () => {
    for (const key of Object.keys(EN)) {
      const en = forms(EN[key]).flatMap(placeholders).sort();
      const bo = forms(BO[key]).flatMap(placeholders).sort();
      expect(bo, key).toEqual(en);
    }
  });

  it('no bo string contains Tibetan digits U+0F20–U+0F29 (Western digits only)', () => {
    for (const key of Object.keys(BO)) {
      for (const s of forms(BO[key])) expect(TIBETAN_DIGIT.test(s), `${key}: ${s}`).toBe(false);
    }
  });

  it('check-tibetan.mjs reports zero findings over the bo strings', () => {
    let status = 0;
    let output = '';
    try {
      output = execFileSync('node', ['.claude/skills/gorshey-tibetan/scripts/check-tibetan.mjs', 'src/i18n/catalogs/bo.json'], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      status = e.status ?? 1;
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    expect(output).toContain('0 error(s), 0 warning(s)');
    expect(status).toBe(0);
  });

  it('the :lang(bo) rules are in src/styles with line-height ≥ 1.9 and letter-spacing normal', () => {
    const css = readFileSync('src/styles/base.css', 'utf8');
    expect(css).toMatch(/:lang\(bo\)\s*\{[^}]*\}/);
    const block = css.match(/:lang\(bo\)\s*\{([^}]*)\}/)![1]!;
    const lh = Number(block.match(/line-height:\s*([\d.]+)/)![1]);
    expect(lh).toBeGreaterThanOrEqual(1.9);
    expect(block).toMatch(/letter-spacing:\s*normal/);
  });
});

// ---- review list ---------------------------------------------------------------------------------

describe('native-speaker review list', () => {
  it('lists every bo key that is not in the reviewed list', () => {
    const keys = Object.keys(BO);
    expect(unreviewedKeys(keys, { reviewed: ['station.name'] })).toEqual(keys.filter((k) => k !== 'station.name'));
  });

  it('every reviewed key exists in bo.json', () => {
    for (const k of REVIEW.reviewed ?? []) expect(Object.keys(BO)).toContain(k);
  });
});

// ---- lookup, interpolation and plurals -----------------------------------------------------------

describe('t(): lookup, interpolation, plurals', () => {
  beforeEach(() => setLocale('en'));

  it('interpolates {n} with Western digits and grouping', () => {
    expect(t('badge.listeners', { n: 1234 })).toBe('1,234 on the kora');
  });

  it('interpolated numbers use Western digits in bo too', () => {
    setLocale('bo');
    const s = t('badge.listeners', { n: 1234 });
    expect(s).toContain('1,234');
    expect(TIBETAN_DIGIT.test(s)).toBe(false);
  });

  it('a missing bo key falls back to en, then to the key itself with a dev warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fx = createI18n(LOCALES, { en: { a: 'A-en', b: 'B-en' }, bo: { a: 'A-bo' } } as Record<string, Catalog>);
    fx.setLocale('bo');
    expect(fx.t('a')).toBe('A-bo');
    expect(fx.t('b')).toBe('B-en');
    expect(fx.t('zzz')).toBe('zzz');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('plural forms are chosen with Intl.PluralRules for the locale', () => {
    const fx = createI18n(LOCALES, {
      en: { item: { one: '{n} item', other: '{n} items' } },
      bo: { item: { other: '{n} རིགས།' } },
    } as Record<string, Catalog>);
    fx.setLocale('en');
    expect(fx.t('item', { n: 1 })).toBe('1 item');
    expect(fx.t('item', { n: 2 })).toBe('2 items');
    fx.setLocale('bo'); // bo has only the "other" category, so 1 also takes "other"
    expect(fx.t('item', { n: 1 })).toBe('1 རིགས།');
  });
});

// ---- detection and persistence -------------------------------------------------------------------

describe('detectLocale and setLocale', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setLocale('en');
  });

  it('a stored locale that is not in LOCALES is ignored', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'fr', setItem: () => {} });
    vi.stubGlobal('navigator', { languages: ['bo-CN'] });
    expect(detectLocale()).toBe('bo');
  });

  it('a valid stored locale wins over the browser languages', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'bo', setItem: () => {} });
    vi.stubGlobal('navigator', { languages: ['en-US'] });
    expect(detectLocale()).toBe('bo');
  });

  it('falls back to en when nothing matches', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('navigator', { languages: ['de-DE'] });
    expect(detectLocale()).toBe('en');
  });

  it('a throwing localStorage does not break detection', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    vi.stubGlobal('navigator', { languages: ['en-GB'] });
    expect(detectLocale()).toBe('en');
  });

  it('setLocale persists, calls the applier, and emits the language change', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem });
    const fx = createI18n(LOCALES, { en: {}, bo: {} } as Record<string, Catalog>);
    const applied: string[] = [];
    const emitted: string[] = [];
    fx.setLocaleApplier((c) => applied.push(c));
    fx.onLocaleChange((l) => emitted.push(l));
    fx.setLocale('bo');
    expect(setItem).toHaveBeenCalledWith('gorshey.locale', 'bo');
    expect(applied).toEqual(['bo']);
    expect(emitted).toEqual(['bo']);
    expect(fx.getLocale()).toBe('bo');
  });

  it('setLocale rejects a code that is not in LOCALES', () => {
    expect(() => setLocale('fr' as Locale)).toThrow();
  });

  it('a throwing localStorage on write still applies the locale', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => setLocale('bo')).not.toThrow();
  });
});

// ---- formatting: Western digits only -------------------------------------------------------------

describe('formatting', () => {
  it('formatTime yields Western digits in both locales', () => {
    for (const loc of ['en', 'bo'] as const) {
      setLocale(loc);
      expect(formatTime(Date.parse('2026-01-01T09:05:00Z'))).toMatch(/^[0-9]{2}:[0-9]{2}$/);
    }
    setLocale('en');
  });

  it('formatDuration yields Western digits', () => {
    expect(formatDuration(211.255167)).toBe('3:31');
  });

  it('formatNumber yields Western digits with grouping', () => {
    expect(formatNumber(3700)).toBe('3,700');
  });

  it('pick uses the locale, then en, then bo, then an empty string', () => {
    expect(pick({ bo: 'བོ', en: 'EN' }, 'bo')).toBe('བོ');
    expect(pick({ en: 'EN' }, 'bo')).toBe('EN');
    expect(pick({ bo: 'བོ' }, 'en')).toBe('བོ');
    expect(pick({}, 'en')).toBe('');
  });
});

// ---- Tibetan markup: lang attributes ------------------------------------------------------------

describe('lang runs for Tibetan text', () => {
  it('a Tibetan track title is tagged bo and its subtitle en, when the UI is English', () => {
    expect(titleParts(TITLE_1, 'en')).toEqual([
      { text: TITLE_1.bo, lang: 'bo' },
      { text: TITLE_1.en, lang: 'en' },
    ]);
    expect(titleParts(TITLE_2, 'en')[0]).toEqual({ text: TITLE_2.bo, lang: 'bo' });
  });

  it('a Tibetan track title is still tagged bo when the UI is Tibetan, with the English subtitle', () => {
    expect(titleParts(TITLE_2, 'bo')).toEqual([
      { text: TITLE_2.bo, lang: 'bo' },
      { text: TITLE_2.en, lang: 'en' },
    ]);
  });

  it('the brand mark carries lang bo on its Tibetan run, whatever the UI language', () => {
    const runs = brandParts();
    const tibetan = runs.filter((r) => TIBETAN.test(r.text));
    expect(tibetan.length).toBeGreaterThan(0);
    for (const r of tibetan) expect(r.lang).toBe('bo');
    expect(runs.find((r) => r.text.includes('Gorshey'))?.lang).toBe('en');
  });
});

// ---- extensibility -------------------------------------------------------------------------------

describe('adding a language needs only a catalog and one LOCALES entry', () => {
  it('French becomes selectable and translates with no other code change', () => {
    const frLocales = [...LOCALES, { code: 'fr', label: 'Français' }] as const;
    const fx = createI18n(frLocales, {
      bo: BO as Catalog,
      en: EN as Catalog,
      fr: { ...(EN as Catalog), 'player.play': 'Lecture' },
    } as Record<string, Catalog>);
    fx.setLocale('fr');
    expect(fx.getLocale()).toBe('fr');
    expect(fx.t('player.play')).toBe('Lecture');
  });
});
