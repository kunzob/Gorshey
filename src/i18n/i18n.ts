import { LOCALES, type Locale } from './locales';
import enCatalog from './catalogs/en.json';
import boCatalog from './catalogs/bo.json';

export type Catalog = Record<string, string | Partial<Record<Intl.LDMLPluralRule, string>>>;
export type Unsubscribe = () => void;
export interface LangRun {
  text: string;
  lang: string;
}

const STORAGE_KEY = 'gorshey.locale';
const TIBETAN = /[ༀ-࿿]/;
const TIBETAN_RUN = /([ༀ-࿿][ༀ-࿿\s]*)/;
const FALLBACK = 'en';

// Western digits always: en-US with the latn numbering system (Intl may default bo to Tibetan digits).
const numberFormat = new Intl.NumberFormat('en-US', { numberingSystem: 'latn' } as Intl.NumberFormatOptions);
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  numberingSystem: 'latn',
} as Intl.DateTimeFormatOptions);

export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

/** Time of day (device time zone) as HH:MM. Takes epoch ms; this module never builds a Date. */
export function formatTime(ms: number): string {
  return timeFormat.format(ms);
}

/** Seconds as m:ss. */
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** map[locale] ?? map.en ?? map.bo ?? ''. */
export function pick(map: Partial<Record<Locale, string>>, locale: Locale): string {
  return map[locale] ?? map.en ?? map.bo ?? '';
}

function isLocale(code: string): code is Locale {
  return LOCALES.some((l) => l.code === code);
}

/** Stored choice (if it is in LOCALES), then the first browser language whose prefix is a locale, then 'en'. */
export function detectLocale(): Locale {
  let stored: string | null = null;
  try {
    stored = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    stored = null; // storage blocked (private window): detection carries on
  }
  if (stored !== null && isLocale(stored)) return stored;
  const languages: readonly string[] = globalThis.navigator?.languages ?? [];
  for (const lang of languages) {
    const prefix = lang.split('-')[0]?.toLowerCase() ?? '';
    if (isLocale(prefix)) return prefix;
  }
  return FALLBACK;
}

export function createI18n<C extends string>(
  locales: ReadonlyArray<{ code: C; label: string }>,
  catalogs: Record<string, Catalog | undefined>,
  initial: C = FALLBACK as C,
) {
  const codes = new Set<string>(locales.map((l) => l.code));
  let current: C = initial;
  let applier: ((code: C) => void) | undefined;
  const listeners = new Set<(l: C) => void>();

  function t(key: string, vars?: Record<string, string | number>): string {
    const raw = catalogs[current]?.[key] ?? catalogs[FALLBACK]?.[key];
    if (raw === undefined) {
      console.warn(`[i18n] missing key: ${key}`);
      return key;
    }
    let template: string;
    if (typeof raw === 'string') {
      template = raw;
    } else {
      const category = new Intl.PluralRules(current).select(Number(vars?.n ?? 0));
      template = raw[category] ?? raw.other ?? key;
    }
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const v = vars?.[name];
      if (v === undefined) return whole;
      return typeof v === 'number' ? formatNumber(v) : v;
    });
  }

  function setLocale(code: C): void {
    if (!codes.has(code)) throw new Error(`Unknown locale: ${code}`);
    current = code;
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, code);
    } catch {
      // storage blocked: the choice still applies for this page view
    }
    applier?.(code);
    listeners.forEach((cb) => cb(code));
  }

  return {
    t,
    setLocale,
    getLocale: (): C => current,
    onLocaleChange(cb: (l: C) => void): Unsubscribe {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    setLocaleApplier(fn: (code: C) => void): void {
      applier = fn;
    },
  };
}

// Text runs for a track title: the Tibetan original always first (lang bo), then the subtitle.
// On the Tibetan UI the subtitle is English, as ARCHITECTURE §5 specifies.
export function titleParts(title: { bo: string; en: string }, locale: Locale): LangRun[] {
  const subtitleLocale: string = locale === 'bo' ? 'en' : locale;
  const own = title as Record<string, string | undefined>;
  const subtitle = own[subtitleLocale] ?? title.en;
  const subtitleLang = own[subtitleLocale] !== undefined ? subtitleLocale : 'en';
  return [
    { text: title.bo, lang: 'bo' },
    { text: subtitle, lang: subtitleLang },
  ];
}

// Brand mark runs: each Tibetan run is tagged bo, every other run en, whatever the UI language.
export function brandParts(): LangRun[] {
  const name = String(enCatalog['station.name']);
  return name
    .split(TIBETAN_RUN)
    .filter((part) => part.length > 0)
    .map((text) => ({ text, lang: TIBETAN.test(text) ? 'bo' : 'en' }));
}

const instance = createI18n(LOCALES, { en: enCatalog as Catalog, bo: boCatalog as Catalog }, detectLocale());

export const t = instance.t;
export const setLocale = instance.setLocale;
export const getLocale = instance.getLocale;
export const onLocaleChange = instance.onLocaleChange;
export const setLocaleApplier = instance.setLocaleApplier;
