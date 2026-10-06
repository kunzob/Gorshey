import { LOCALES, type Locale } from '../i18n/locales';

/** The button shows the label of the next locale in LOCALES (the one a tap switches to). */
export function localeToggleTarget(current: Locale): { code: Locale; label: string } {
  const idx = LOCALES.findIndex((l) => l.code === current);
  const next = LOCALES[(idx + 1) % LOCALES.length]!;
  return { code: next.code, label: next.label };
}
