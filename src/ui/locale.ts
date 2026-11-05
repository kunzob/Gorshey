import type { Locale } from '../i18n/locales';

/**
 * The one place that writes <html lang>. CSS :lang(bo) follows from it. It also marks the document ready: the player
 * stays visibility-hidden until then (components.css), so nothing is ever laid out with the wrong line heights first.
 */
export function applyDocumentLang(code: Locale): void {
  document.documentElement.lang = code;
  document.documentElement.setAttribute('data-lang-ready', '');
}

/**
 * Marks the player ready once the first data (or the boot-failure state) is painted. Until then the player also stays
 * visibility-hidden (components.css): the language gate opens before the track manifest arrives, and a title or
 * next-up line longer than its reserved lines would otherwise move the centred column when the data fills in.
 */
export function markPlayerReady(): void {
  document.documentElement.setAttribute('data-player-ready', '');
}
