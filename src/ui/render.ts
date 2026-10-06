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

export function mountPlayer(opts: {
  engine: AudioEngine;
  manifest: Manifest;
  now: () => number;
  offline: () => boolean;
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

  function paintTrack(locale: Locale): void {
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

  function paintStatus(): void {
    const key = statusKey(state, offline);
    r.status.textContent = key ? t(key) : '';
  }

  function paintLocale(locale: Locale): void {
    writeRuns(r.station, brandParts());
    const target = localeToggleTarget(locale);
    r.locale.textContent = target.label;
    r.locale.setAttribute('aria-label', target.label);
    r.locale.lang = target.code;
    r.eyebrow.textContent = t('eyebrow.line', { live: t('player.live'), place: t('place.marpoRi') });
    r.update.textContent = t('update.available');
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

  paintLocale(getLocale());

  return {
    unmount(): void {
      offState();
      offTrack();
      offTick();
      offLocale();
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
