// The only module that writes the player DOM. Text goes in with textContent; Latin and Tibetan runs are separate spans.
import type { AudioEngine, EngineState } from '../audio/AudioEngine';
import type { Manifest } from '../core/types';
import { brandParts, getLocale, onLocaleChange, setLocale, t, titleParts, type LangRun } from '../i18n/i18n';
import type { Locale } from '../i18n/locales';
import { refs } from './dom';
import { setRing } from './KoraRing';
import { localeToggleTarget } from './LocaleToggle';
import { nextUpRuns, playLabelKey, positionLabel, statusKey } from './view';

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

export interface Player {
  unmount(): void;
  /** Reserved slot for the PWA "update available" prompt (M8). Not wired yet. */
  showUpdate(): void;
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
  let trackIdx = 0;
  let positionSec = 0;
  let state: EngineState = engine.state;
  let offline = opts.offline();

  const duration = (): number => durations[trackIdx] ?? 0;
  const artistFor = (locale: Locale): string => {
    const artist = manifest.tracks[trackIdx]?.artist;
    return artist ? artist[locale === 'bo' ? 'bo' : 'en'] : '';
  };

  function paintArtwork(): void {
    const art = manifest.tracks[trackIdx]?.artwork;
    if (art) {
      r.artwork.src = art;
      r.artwork.hidden = false;
    } else {
      r.artwork.removeAttribute('src');
      r.artwork.hidden = true;
    }
  }

  function paintTrack(locale: Locale): void {
    paintArtwork();
    const runs = titleParts(manifest.tracks[trackIdx]!.title, locale);
    writeRuns(r.title, [runs[0]!]);
    writeRuns(r.subtitle, [runs[1]!]);
    r.artist.textContent = artistFor(locale);
    writeNextUp(r.nextup, t('player.nextUp'), nextUpRuns(manifest, now(), locale), locale);
  }

  function paintPlayer(): void {
    const active = ACTIVE.includes(state);
    r.play.textContent = t(playLabelKey(state));
    r.position.textContent = positionLabel(positionSec, duration(), active);
    setRing(r.ringFill, active ? positionSec : 0, duration());
  }

  /** Listener count only while watching or listening with a number; otherwise the placeholder (never a fake count). */
  function paintBadge(c: { state: string; count: number | null } | null): void {
    const live = c !== null && (c.state === 'listening' || c.state === 'watching') && c.count !== null;
    r.badge.textContent = live ? t('badge.listeners', { n: c.count as number }) : t('badge.unknown');
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
    state = s;
    paintPlayer();
    paintStatus();
  });
  const offTrack = engine.on('track', (idx) => {
    trackIdx = idx;
    paintTrack(getLocale());
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
  r.artwork.addEventListener('error', onArtError);

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

  return {
    unmount(): void {
      offPresence();
      offState();
      offTrack();
      offTick();
      offLocale();
      r.artwork.removeEventListener('error', onArtError);
      r.play.removeEventListener('click', onPlay);
      r.locale.removeEventListener('click', onLocale);
      window.removeEventListener('online', onNetwork);
      window.removeEventListener('offline', onNetwork);
    },
    showUpdate(): void {
      r.update.hidden = false;
    },
  };
}
