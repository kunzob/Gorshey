// Wiring only. No logic until later milestones.
import '../src/styles/tokens.css';
import '../src/styles/fonts.css';
import '../src/styles/base.css';
import '../src/styles/components.css';
import { measureOffset, now, onOffsetChange, refineOffset, syncPrecision } from './core/clock';
import { AudioEngine, type EngineState } from './audio/AudioEngine';
import { getLocale, setLocaleApplier } from './i18n/i18n';
import { Presence, readConfig, tabKey } from './presence';
import { createSupabaseTransport } from './presence/transport';
import { loadManifest } from './net/loadManifest';
import { startClock } from './ui/ClockView';
import { refs } from './ui/dom';
import { mountPlayer } from './ui/render';
import { applyDocumentLang } from './ui/locale';
import { onBecameVisible } from './ui/visibility';

// Hot reload: tear down the previous engine, presence and listeners before the module is replaced,
// so a second audio element or socket never runs alongside the first.
let teardown: () => void = () => {};
import.meta.hot?.dispose(() => teardown());

const ACTIVE: EngineState[] = ['loading', 'playing', 'buffering'];

async function boot(): Promise<void> {
  setLocaleApplier(applyDocumentLang);
  applyDocumentLang(getLocale());

  await measureOffset(); // coarse first, so play is never delayed
  const manifest = await loadManifest('/manifest.json');
  const clock = { now, isRefined: () => syncPrecision() === 'refined' };
  const engine = new AudioEngine(manifest, clock);
  const offOffset = onOffsetChange(({ previousOffset, offset }) => engine.onClockRefined((offset - previousOffset) / 1000));

  // Presence connects lazily: the first time the engine is active. Nothing opens a socket at boot.
  const cfg = readConfig(import.meta.env as unknown as Record<string, string | undefined>);
  const presence = new Presence({
    now,
    createTransport: () => (cfg ? createSupabaseTransport(cfg, tabKey()) : null),
    isOnline: () => navigator.onLine,
  });
  const offPresence = engine.on('state', (s) => presence.setListening(ACTIVE.includes(s)));
  const onPageHide = (): void => presence.leave();
  const onOffline = (): void => presence.onOffline();
  const onOnline = (): void => presence.onOnline();
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);

  const player = mountPlayer({
    engine,
    manifest,
    now,
    offline: () => !navigator.onLine,
    presence,
  });
  const stopClock = startClock(refs().clock, now);
  const offVisible = onBecameVisible(() => engine.onVisible());
  void refineOffset(); // background: never blocks playback

  teardown = () => {
    offVisible();
    stopClock();
    offOffset();
    offPresence();
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
    player.unmount();
    presence.destroy();
    engine.destroy();
  };
}

void boot();
