// Wiring only. No logic until later milestones.
import '../src/styles/tokens.css';
import '../src/styles/fonts.css';
import '../src/styles/base.css';
import '../src/styles/components.css';
import { measureOffset, now, onOffsetChange, refineOffset, syncPrecision } from './core/clock';
import { AudioEngine } from './audio/AudioEngine';
import { getLocale, setLocaleApplier } from './i18n/i18n';
import { loadManifest } from './net/loadManifest';
import { startClock } from './ui/ClockView';
import { refs } from './ui/dom';
import { mountPlayer } from './ui/render';
import { applyDocumentLang } from './ui/locale';
import { onBecameVisible } from './ui/visibility';

// Hot reload: tear down the previous engine and listeners before the module is replaced,
// so a second audio element never plays alongside the first.
let teardown: () => void = () => {};
import.meta.hot?.dispose(() => teardown());

async function boot(): Promise<void> {
  setLocaleApplier(applyDocumentLang);
  applyDocumentLang(getLocale());

  await measureOffset(); // coarse first, so play is never delayed
  const manifest = await loadManifest('/manifest.json');
  const clock = { now, isRefined: () => syncPrecision() === 'refined' };
  const engine = new AudioEngine(manifest, clock);
  const offOffset = onOffsetChange(({ previousOffset, offset }) => engine.onClockRefined((offset - previousOffset) / 1000));
  const player = mountPlayer({
    engine,
    manifest,
    now,
    offline: () => !navigator.onLine,
  });
  const stopClock = startClock(refs().clock, now);
  const offVisible = onBecameVisible(() => engine.onVisible());
  void refineOffset(); // background: never blocks playback

  teardown = () => {
    offVisible();
    stopClock();
    offOffset();
    player.unmount();
    engine.destroy();
  };
}

void boot();
