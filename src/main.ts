// Wiring only. No logic until later milestones.
import './styles/tibetan.css';
import { measureOffset, now, onOffsetChange, refineOffset, syncPrecision } from './core/clock';
import { AudioEngine } from './audio/AudioEngine';
import { getLocale, setLocaleApplier } from './i18n/i18n';
import { loadManifest } from './net/loadManifest';
import { applyDocumentLang } from './ui/locale';
import { mountDevHarness } from './ui/devHarness';

async function boot(): Promise<void> {
  // Locale first: detectLocale() ran when the i18n module loaded, so <html lang> is right before anything renders.
  setLocaleApplier(applyDocumentLang);
  applyDocumentLang(getLocale());

  await measureOffset(); // coarse first, so play is never delayed
  const manifest = await loadManifest('/manifest.json');
  const clock = { now, isRefined: () => syncPrecision() === 'refined' };
  const engine = new AudioEngine(manifest, clock);
  onOffsetChange(({ previousOffset, offset }) => engine.onClockRefined((offset - previousOffset) / 1000));
  mountDevHarness(
    engine,
    manifest.tracks.map((t) => t.duration),
  );
  void refineOffset(); // background: never blocks playback
}

void boot();
