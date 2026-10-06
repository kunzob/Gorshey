// Wiring only. No logic until later milestones.
import { measureOffset, now, onOffsetChange, refineOffset, syncPrecision } from './core/clock';
import { AudioEngine } from './audio/AudioEngine';
import { loadManifest } from './net/loadManifest';
import { mountDevHarness } from './ui/devHarness';

async function boot(): Promise<void> {
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
