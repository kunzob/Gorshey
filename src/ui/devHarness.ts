// TEMPORARY dev harness for M3: a play/pause button and a text readout to exercise AudioEngine by hand.
// Removed in M5 when the real UI shell lands.
import type { AudioEngine, EngineState, TickEvent } from '../audio/AudioEngine';

const ACTIVE: EngineState[] = ['loading', 'playing', 'buffering'];

/** Mounts the harness under `root` (default: body) and returns an unmount function. */
export function mountDevHarness(engine: AudioEngine, root: HTMLElement = document.body): () => void {
  const button = document.createElement('button');
  button.type = 'button';
  const readout = document.createElement('pre');
  root.append(button, readout);

  let track = '—';
  let position = '—';

  const render = (): void => {
    button.textContent = ACTIVE.includes(engine.state) ? 'Pause' : 'Play';
    readout.textContent = `state: ${engine.state}\ntrack: ${track}\nposition: ${position}`;
  };

  const onClick = (): void => {
    if (ACTIVE.includes(engine.state)) engine.pause();
    else engine.play();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') engine.onVisible();
  };

  button.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', onVisibility);

  const offState = engine.on('state', render);
  const offTrack = engine.on('track', (idx: number) => {
    track = String(idx);
    render();
  });
  const offTick = engine.on('tick', (t: TickEvent) => {
    position = `${t.positionSec.toFixed(2)} s`;
    render();
  });
  render();

  return () => {
    button.removeEventListener('click', onClick);
    document.removeEventListener('visibilitychange', onVisibility);
    offState();
    offTrack();
    offTick();
    button.remove();
    readout.remove();
  };
}
