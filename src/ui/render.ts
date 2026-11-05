// The only module that writes the player DOM. Text goes in with textContent; Latin and Tibetan runs are separate spans.
import type { AudioEngine, EngineState } from '../audio/AudioEngine';
import type { Manifest } from '../core/types';
import { brandParts, getLocale, onLocaleChange, setLocale, t, tFor, titleParts, type LangRun } from '../i18n/i18n';
import { LOCALES, type Locale } from '../i18n/locales';
import { refs } from './dom';
import { applyDocumentLang, markPlayerReady } from './locale';
import { setRing } from './KoraRing';
import { localeToggleTarget } from './LocaleToggle';
import { buildIndex, shownTracks } from '../core/schedule';
import { nextUpRunsFor, playLabelKey, positionLabel, statusKey } from './view';

/** Replaces an element's children with one span per run, each tagged with its language. */
function writeRuns(el: HTMLElement, runs: LangRun[]): void {
  el.textContent = '';
  for (const run of runs) {
    const span = document.createElement('span');
    span.lang = run.lang;
    span.textContent = run.text;
    el.append(span);
  }
}

/** Next-up line: label, a space, then the title runs joined by the catalog separator (text, not a span). */
function writeNextUp(el: HTMLElement, label: string, runs: LangRun[], locale: Locale): void {
  el.textContent = '';
  const labelSpan = document.createElement('span');
  labelSpan.lang = locale;
  labelSpan.textContent = label;
  el.append(labelSpan, ' ');
  runs.forEach((run, i) => {
    if (i > 0) el.append(t('list.separator'));
    const span = document.createElement('span');
    span.lang = run.lang;
    span.textContent = run.text;
    el.append(span);
  });
}

const ACTIVE: EngineState[] = ['loading', 'playing', 'buffering'];

/**
 * Invisible copies of every play/pause label in every locale, stacked in the play button's grid cell, so the pill is
 * always as wide as the longest label and play, pause or a locale swap never resizes it. aria-hidden spans, not
 * buttons: the real button keeps its own text and accessible name. Returns a remover for unmount.
 */
function mountPlaySizers(controls: HTMLElement): () => void {
  const sizers = LOCALES.flatMap(({ code }) =>
    (['player.play', 'player.pause'] as const).map((key) => {
      const s = document.createElement('span');
      s.className = 'play play-sizer';
      s.setAttribute('aria-hidden', 'true');
      s.lang = code;
      s.textContent = tFor(code, key);
      return s;
    }),
  );
  controls.append(...sizers);
  return () => sizers.forEach((s) => s.remove());
}

export interface Player {
  unmount(): void;
  /** Shows the "update available" button (M8). Its click is wired in updatePrompt.ts. */
  showUpdate(): void;
  /** Called on the clock's once-a-second tick: while not playing, the strip follows the schedule across boundaries. */
  onClockTick(): void;
}

export interface PresenceLike {
  onChange(cb: (c: { state: string; count: number | null }) => void): () => void;
}

export function mountPlayer(opts: {
  engine: AudioEngine;
  manifest: Manifest;
  now: () => number;
  offline: () => boolean;
  presence?: PresenceLike;
}): Player {
  const { engine, manifest, now } = opts;
  const r = refs();
  const durations = manifest.tracks.map((tr) => tr.duration);
  const starts = buildIndex(manifest.tracks);
  // The strip shows the engine's track while it is active, and the scheduled track otherwise (shownTracks).
  let engineIdx: number | null = null;
  let trackIdx = 0;
  let nextIdx = 0;
  let positionSec = 0;
  let state: EngineState = engine.state;
  let offline = opts.offline();
  let updateAnnounced = false;
  const removeSizers = mountPlaySizers(r.play.parentElement as HTMLElement);

  const duration = (): number => durations[trackIdx] ?? 0;
  const artistFor = (locale: Locale): string => {
    const artist = manifest.tracks[trackIdx]?.artist;
    return artist ? artist[locale === 'bo' ? 'bo' : 'en'] : '';
  };

  /**
   * The image is hidden whenever its source changes and shown only on `load` (hidden again on `error`), so no
   * broken-image icon ever shows. Repainting with the same URL is a no-op: it keeps a loaded image visible and a
   * failed one hidden. The image sits absolutely inside the fixed-size halo, so hiding it never shifts layout.
   */
  function paintArtwork(): void {
    const art = manifest.tracks[trackIdx]?.artwork;
    if (art) {
      if (r.artwork.getAttribute('src') === art) return;
      r.artwork.hidden = true;
      r.artwork.src = art;
    } else {
      r.artwork.removeAttribute('src');
      r.artwork.hidden = true;
    }
  }

  const isActive = (): boolean => ACTIVE.includes(state);
  const shown = (): { trackIdx: number; nextIdx: number } =>
    shownTracks(now(), manifest.epochMs, starts, isActive() ? engineIdx : null);

  /** Title, artist, artwork and next-up from ONE resolution, so title and next-up can never disagree. */
  function paintTrack(locale: Locale, s = shown()): void {
    trackIdx = s.trackIdx;
    nextIdx = s.nextIdx;
    paintArtwork();
    const runs = titleParts(manifest.tracks[trackIdx]!.title, locale);
    writeRuns(r.title, [runs[0]!]);
    writeRuns(r.subtitle, [runs[1]!]);
    // The block takes its text's language, so :lang(bo) line height never reaches an English subtitle in bo mode.
    r.subtitle.lang = runs[1]!.lang;
    r.artist.textContent = artistFor(locale);
    writeNextUp(r.nextup, t('player.nextUp'), nextUpRunsFor(manifest, nextIdx, locale), locale);
  }

  /** Repaints the track rows only when what should be shown changed (no flicker within a track). */
  function syncTrack(): void {
    const s = shown();
    if (s.trackIdx !== trackIdx || s.nextIdx !== nextIdx) paintTrack(getLocale(), s);
  }

  function paintPlayer(): void {
    const active = ACTIVE.includes(state);
    r.play.textContent = t(playLabelKey(state));
    r.position.textContent = positionLabel(positionSec, duration(), active);
    setRing(r.ringFill, active ? positionSec : 0, duration());
    r.halo.toggleAttribute('data-active', active);
  }

  /**
   * Listener count only while watching or listening with a number; otherwise the placeholder (never a fake count).
   * The dot turns live (gold, pulsing) only with a real count, so the placeholder never looks live.
   */
  function paintBadge(c: { state: string; count: number | null } | null): void {
    const live = c !== null && (c.state === 'listening' || c.state === 'watching') && c.count !== null;
    r.badge.textContent = live ? t('badge.listeners', { n: c.count as number }) : t('badge.unknown');
    r.dot.toggleAttribute('data-live', live);
  }

  function paintStatus(): void {
    const key = statusKey(state, offline);
    r.status.textContent = key ? t(key) : '';
  }

  function paintLocale(locale: Locale): void {
    writeRuns(r.station, brandParts());
    const target = localeToggleTarget(locale);
    // The label is a span in its own language; the button itself stays in the UI language.
    const label = document.createElement('span');
    label.lang = target.code;
    label.textContent = target.label;
    r.locale.replaceChildren(label);
    r.locale.setAttribute('aria-label', target.label);
    r.locale.lang = locale;
    r.eyebrow.textContent = t('eyebrow.line', { live: t('player.live'), place: t('place.marpoRi') });
    r.update.textContent = t('update.available');
    writeRuns(r.footer, [{ text: t('footer.line'), lang: locale }]);
    paintTrack(locale);
    paintPlayer();
    paintStatus();
  }

  const offState = engine.on('state', (s) => {
    const wasActive = isActive();
    state = s;
    if (wasActive !== isActive()) syncTrack(); // play hands the strip to the engine, pause back to the clock
    paintPlayer();
    paintStatus();
  });
  const offTrack = engine.on('track', (idx) => {
    engineIdx = idx;
    if (isActive()) syncTrack();
    paintPlayer();
  });
  const offTick = engine.on('tick', (tick) => {
    positionSec = tick.positionSec;
    paintPlayer();
  });
  const offLocale = onLocaleChange((locale) => paintLocale(locale));
  // A missing or failing image is hidden, so the ring stays and no broken-image icon shows.
  const onArtError = (): void => {
    r.artwork.hidden = true;
  };
  // A late load for a source the current track no longer has (or no source at all) changes nothing.
  const onArtLoad = (): void => {
    const art = manifest.tracks[trackIdx]?.artwork;
    if (art && r.artwork.getAttribute('src') === art) r.artwork.hidden = false;
  };
  r.artwork.addEventListener('error', onArtError);
  r.artwork.addEventListener('load', onArtLoad);

  const onPlay = (): void => {
    if (ACTIVE.includes(state)) engine.pause();
    else engine.play();
  };
  const onLocale = (): void => {
    setLocale(localeToggleTarget(getLocale()).code);
  };
  const onNetwork = (): void => {
    offline = opts.offline();
    paintStatus();
  };

  r.play.addEventListener('click', onPlay);
  r.locale.addEventListener('click', onLocale);
  window.addEventListener('online', onNetwork);
  window.addEventListener('offline', onNetwork);

  paintBadge(null);
  const offPresence = opts.presence?.onChange((c) => paintBadge(c)) ?? (() => {});

  paintLocale(getLocale());
  markPlayerReady(); // after the first paint with data: nothing in the hidden column can shift any more

  return {
    unmount(): void {
      offPresence();
      offState();
      offTrack();
      offTick();
      offLocale();
      r.artwork.removeEventListener('error', onArtError);
      r.artwork.removeEventListener('load', onArtLoad);
      removeSizers();
      r.play.removeEventListener('click', onPlay);
      r.locale.removeEventListener('click', onLocale);
      window.removeEventListener('online', onNetwork);
      window.removeEventListener('offline', onNetwork);
    },
    onClockTick(): void {
      if (!isActive()) syncTrack();
    },
    showUpdate(): void {
      r.update.hidden = false;
      if (updateAnnounced) return;
      updateAnnounced = true;
      // A hidden live region is not announced when it appears, so the existing polite #status region carries the
      // same catalog string, visually hidden (the button already shows it). A later status write replaces it.
      const note = document.createElement('span');
      note.className = 'sr-only';
      note.lang = getLocale();
      note.textContent = t('update.available');
      r.status.append(note);
    },
  };
}

/**
 * Boot could not load the track manifest (offline with nothing cached, or a server error). Shows the brand and
 * the status only; the placeholders stay, so no track or count is invented, and the play button is inert.
 */
export function showBootFailure(offline: boolean): void {
  // Apply the language (and with it the ready flag) here too, so a boot that failed before or around the normal
  // applyDocumentLang call can never leave the player hidden.
  applyDocumentLang(getLocale());
  const r = refs();
  writeRuns(r.station, brandParts());
  r.status.textContent = t(offline ? 'player.offline' : 'player.error');
  r.play.textContent = t('player.play');
  r.play.disabled = true;
  markPlayerReady();
}
