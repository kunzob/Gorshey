// Wiring only. No logic until later milestones.
import { measureOffset, now } from './core/clock';
import { AudioEngine } from './audio/AudioEngine';
import { loadManifest } from './net/loadManifest';
import { mountDevHarness } from './ui/devHarness';

async function boot(): Promise<void> {
  await measureOffset();
  const manifest = await loadManifest('/manifest.json');
  const engine = new AudioEngine(manifest, { now });
  mountDevHarness(
    engine,
    manifest.tracks.map((t) => t.duration),
  );
}

void boot();
