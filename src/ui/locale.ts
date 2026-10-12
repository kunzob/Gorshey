import type { Locale } from '../i18n/locales';

/**
 * The one place that writes <html lang>. CSS :lang(bo) follows from it. It also marks the document ready: the player
 * stays visibility-hidden until then (components.css), so nothing is ever laid out with the wrong line heights first.
 */
export function applyDocumentLang(code: Locale): void {
  document.documentElement.lang = code;
  document.documentElement.setAttribute('data-lang-ready', '');
}
