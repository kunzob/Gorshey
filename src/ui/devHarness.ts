// TEMPORARY dev harness for M3: a play/pause button and a debug readout to exercise AudioEngine by hand.
// Removed in M5 when the real UI shell lands.
import type { AudioEngine, DebugSnapshot, EngineState } from '../audio/AudioEngine';
import { getOffset, syncPrecision } from '../core/clock';

const ACTIVE: EngineState[] = ['loading', 'playing', 'buffering'];
const READOUT_MS = 1000;

/**
 * Mounts the harness under `root` (default: body) and returns an unmount function.
 * `durationsSec` are the manifest durations, so el.duration can be compared with them.
 */
export function mountDevHarness(
  engine: AudioEngine,
  durationsSec: number[],
  root: HTMLElement = document.body,
): () => void {
  const button = document.createElement('button');
  button.type = 'button';
  const readout = document.createElement('pre');
  root.append(button, readout);

  const format = (s: DebugSnapshot): string => {
    const manifestDur = durationsSec[s.trackIdx];
    const sign = s.driftSec >= 0 ? '+' : '';
    return [
      `state:           ${s.state}`,
      `track:           ${s.trackIdx} (clock says ${s.expectedTrackIdx})`,
      `expected:        ${s.expectedSec.toFixed(2)} s   (clock.now() + resolve)`,
      `actual:          ${s.actualSec.toFixed(2)} s   (el.currentTime)`,
      `drift:           ${sign}${s.driftSec.toFixed(2)} s   (actual - expected)`,
      `duration:        el ${s.elDurationSec.toFixed(3)} s / manifest ${manifestDur?.toFixed(3) ?? '—'} s`,
      `corrections:     ${s.corrections} / 3${s.capHit ? '  CAP HIT' : ''}`,
      `clock:           ${syncPrecision()}, offset ${getOffset().toFixed(0)} ms`,
    ].join('\n');
  };

  const isActive = (): boolean => ACTIVE.includes(engine.state);
  const render = (): void => {
    button.textContent = isActive() ? 'Pause' : 'Play';
    readout.textContent = format(engine.debugSnapshot());
  };

  const onClick = (): void => {
    if (isActive()) engine.pause();
    else engine.play();
    render();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') engine.onVisible();
    render();
  };

  button.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(render, READOUT_MS);
  const offState = engine.on('state', render);
  const offTrack = engine.on('track', render);
  render();

  return () => {
    clearInterval(timer);
    button.removeEventListener('click', onClick);
    document.removeEventListener('visibilitychange', onVisibility);
    offState();
    offTrack();
    button.remove();
    readout.remove();
  };
}
