import type { Locale } from '../i18n/locales';

/** The one place that writes <html lang>. CSS :lang(bo) follows from it. */
export function applyDocumentLang(code: Locale): void {
  document.documentElement.lang = code;
}
