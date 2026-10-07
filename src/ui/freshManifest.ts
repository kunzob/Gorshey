import type { AudioEngine, EngineState } from '../audio/AudioEngine';

// Reload would cut audio the listener asked for, so it waits while any of these hold.
const BUSY: EngineState[] = ['loading', 'playing', 'buffering'];

/**
 * Used only when boot ran on the service worker's cached track manifest (offline). When the network returns,
 * reload once for a fresh one, but never while the engine is loading, playing or buffering; in that case
 * the reload waits for the next idle, paused or error state. The reload is a normal boot: clock first.
 */
export function reloadWhenOnline(opts: { engine: Pick<AudioEngine, 'state' | 'on'>; reload: () => void }): () => void {
  const { engine } = opts;
  let pending = false;
  let done = false;

  const tryReload = (): void => {
    if (!pending || done || BUSY.includes(engine.state)) return;
    done = true;
    opts.reload();
  };
  const onOnline = (): void => {
    pending = true;
    tryReload();
  };

  window.addEventListener('online', onOnline);
  const offState = engine.on('state', tryReload);
  return () => {
    window.removeEventListener('online', onOnline);
    offState();
  };
}
