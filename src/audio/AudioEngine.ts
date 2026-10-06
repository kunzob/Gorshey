import { buildIndex, resolve, type Position } from '../core/schedule';
import type { Clock, Manifest } from '../core/types';
import { Emitter, type Unsubscribe } from './emitter';

export type EngineState = 'idle' | 'loading' | 'playing' | 'buffering' | 'paused' | 'error';

export interface TickEvent {
  trackIdx: number;
  positionSec: number;
}

/** Debug readout for the dev harness: where the clock says we should be, and where the element is. */
export interface DebugSnapshot {
  state: EngineState;
  trackIdx: number;
  expectedTrackIdx: number;
  expectedSec: number;
  actualSec: number;
  driftSec: number; // actual − expected: negative means behind the clock
  elDurationSec: number;
  corrections: number;
  capHit: boolean;
}

type Events = {
  state: EngineState;
  track: number;
  tick: TickEvent;
};

const TICK_MS = 250;
const DRIFT_TOLERANCE_S = 2;
const RETRY_DELAY_MS = 3000;
const MAX_RELOADS = 3; // reloads allowed without reaching playing; the next one enters error
const DRIFT_CORRECT_S = 0.75; // drift beyond this, checked on each transition to playing, is corrected
const MAX_CORRECTIONS = 3; // per play session

/**
 * Plays the clock-derived live position through one persistent <audio> element.
 * Every (re)start re-resolves the position from the clock; nothing advances idx+1.
 */
export class AudioEngine {
  private readonly el: HTMLAudioElement;
  private readonly clock: Clock;
  private readonly starts: number[];
  private readonly srcs: string[];
  private readonly epochMs: number;
  private readonly emitter = new Emitter<Events>();

  private status: EngineState = 'idle';
  private wantPlaying = false; // user intent: true from play() until pause(), error or destroy()
  private currentIdx = -1;
  private loadToken = 0; // bumped on every (re)load and on pause; stale callbacks compare against it
  private retriesLeft = 1;
  private reloads = 0; // reloads since the last time the element reached playing
  private corrections = 0; // drift seeks in this play session
  private capHit = false;
  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private boundaryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(manifest: Manifest, clock: Clock, el?: HTMLAudioElement) {
    this.el = el ?? new Audio();
    this.el.preload = 'none';
    this.clock = clock;
    this.starts = buildIndex(manifest.tracks);
    this.srcs = manifest.tracks.map((t) => t.src);
    this.epochMs = manifest.epochMs;

    this.el.addEventListener('loadedmetadata', this.onMetadata);
    this.el.addEventListener('playing', this.onPlaying);
    this.el.addEventListener('waiting', this.onStall);
    this.el.addEventListener('stalled', this.onStall);
    this.el.addEventListener('ended', this.onEnded);
    this.el.addEventListener('error', this.onError);
  }

  get state(): EngineState {
    return this.status;
  }

  on<K extends keyof Events>(event: K, cb: (payload: Events[K]) => void): Unsubscribe {
    return this.emitter.on(event, cb);
  }

  /** Call from a click handler. Re-syncs to the live position every time. */
  play(): void {
    if (this.wantPlaying && (this.status === 'loading' || this.status === 'playing' || this.status === 'buffering')) {
      return;
    }
    this.wantPlaying = true;
    this.retriesLeft = 1;
    this.reloads = 0;
    this.corrections = 0;
    this.capHit = false;
    this.startLoad(false);
  }

  /** Leaves the live stream. The next play() re-syncs; the old position is never resumed. */
  pause(): void {
    if (!this.wantPlaying) return;
    this.wantPlaying = false;
    this.loadToken++;
    this.clearTimers();
    this.el.pause();
    this.setState('paused');
  }

  /** Call on visibilitychange to visible. Re-syncs if the track changed or the element drifted. */
  onVisible(): void {
    if (!this.wantPlaying || (this.status !== 'playing' && this.status !== 'buffering')) return;
    const pos = this.locate();
    if (pos.trackIdx !== this.currentIdx) {
      this.startLoad();
      return;
    }
    if (Math.abs(pos.offsetSec - this.el.currentTime) > DRIFT_TOLERANCE_S) {
      this.el.currentTime = pos.offsetSec;
    }
  }

  /** Snapshot for the debug readout. Reads the clock only through the injected clock. */
  debugSnapshot(): DebugSnapshot {
    const pos = this.locate();
    const actualSec = this.el.currentTime;
    return {
      state: this.status,
      trackIdx: this.currentIdx,
      expectedTrackIdx: pos.trackIdx,
      expectedSec: pos.offsetSec,
      actualSec,
      driftSec: actualSec - pos.offsetSec,
      elDurationSec: this.el.duration,
      corrections: this.corrections,
      capHit: this.capHit,
    };
  }

  destroy(): void {
    this.wantPlaying = false;
    this.loadToken++;
    this.clearTimers();
    this.el.pause();
    this.el.removeEventListener('loadedmetadata', this.onMetadata);
    this.el.removeEventListener('playing', this.onPlaying);
    this.el.removeEventListener('waiting', this.onStall);
    this.el.removeEventListener('stalled', this.onStall);
    this.el.removeEventListener('ended', this.onEnded);
    this.el.removeEventListener('error', this.onError);
    this.emitter.clear();
  }

  // ---- internals -------------------------------------------------------

  private locate(): Position {
    return resolve(this.clock.now(), this.epochMs, this.starts);
  }

  private setState(next: EngineState): void {
    if (this.status === next) return;
    this.status = next;
    this.emitter.emit('state', next);
  }

  private setTrack(idx: number): void {
    if (idx === this.currentIdx) return;
    this.currentIdx = idx;
    this.emitter.emit('track', idx);
  }

  /**
   * Resolves from the clock, sets src, and starts play() at once (iOS needs the call inside the tap).
   * `isReload` is false only for the first load of a play() call; every other load counts toward the cap.
   */
  private startLoad(isReload = true): void {
    if (isReload) {
      if (this.reloads >= MAX_RELOADS) {
        this.fail();
        return;
      }
      this.reloads++;
    }
    const token = ++this.loadToken;
    this.clearTimers();
    const pos = this.locate();
    this.setTrack(pos.trackIdx);
    this.el.src = this.srcs[pos.trackIdx] as string; // index is in range: resolve returns a valid track
    this.setState('loading');
    this.el.play().catch(() => this.onPlayRejected(token));
  }

  /** Seeks only after metadata; re-resolves first because time has passed while loading. */
  private onMetadata = (): void => {
    if (!this.wantPlaying) return;
    const pos = this.locate();
    if (pos.trackIdx !== this.currentIdx) {
      this.startLoad();
      return;
    }
    this.el.currentTime = pos.offsetSec;
  };

  private onPlaying = (): void => {
    if (!this.wantPlaying) return;
    this.retriesLeft = 1;
    this.reloads = 0;
    this.setState('playing');
    this.startTick();
    this.correctDrift();
  };

  /**
   * Runs on each transition to playing (covers a buffering recovery). Seeks to the clock-derived
   * position when drift exceeds the threshold, at most MAX_CORRECTIONS per play session.
   */
  private correctDrift(): void {
    if (!this.wantPlaying || this.status !== 'playing') return;
    const pos = this.locate();
    if (pos.trackIdx !== this.currentIdx) {
      this.startLoad();
      return;
    }
    const drift = this.el.currentTime - pos.offsetSec;
    if (Math.abs(drift) <= DRIFT_CORRECT_S) return;
    if (this.corrections >= MAX_CORRECTIONS) {
      this.capHit = true;
      return;
    }
    this.corrections++;
    this.el.currentTime = pos.offsetSec;
  }

  private onStall = (): void => {
    if (this.wantPlaying && this.status === 'playing') this.setState('buffering');
  };

  private onEnded = (): void => {
    if (!this.wantPlaying) return;
    this.stopTick();
    this.setState('loading');
    this.waitForNextTrack();
  };

  /**
   * Loads the track the clock resolves to. If the clock still says the track that just ended
   * (lag, or the boundary is a fraction of a millisecond away), re-check at endsAtMs and never reload the old track.
   */
  private waitForNextTrack(): void {
    const pos = this.locate();
    if (pos.trackIdx !== this.currentIdx) {
      this.startLoad();
      return;
    }
    const delay = Math.max(1, pos.endsAtMs - this.clock.now());
    this.boundaryTimer = setTimeout(() => {
      this.boundaryTimer = undefined;
      if (this.wantPlaying) this.waitForNextTrack();
    }, delay);
  }

  private onError = (): void => {
    if (!this.wantPlaying) return;
    this.stopTick();
    if (this.retriesLeft > 0) {
      this.retriesLeft--;
      this.setState('loading');
      const token = this.loadToken;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        if (this.wantPlaying && token === this.loadToken) this.startLoad();
      }, RETRY_DELAY_MS);
      return;
    }
    this.fail();
  };

  /** Terminal until the next play(): stops the element, drops every pending callback, reports error. */
  private fail(): void {
    this.wantPlaying = false;
    this.loadToken++;
    this.clearTimers();
    this.el.pause();
    this.setState('error');
  }

  /**
   * Only the current load may react. A rejection here (autoplay blocked, or interrupted) returns to a
   * tappable paused state and invalidates the load, so no late event or timer can start playback.
   */
  private onPlayRejected(token: number): void {
    if (token !== this.loadToken || !this.wantPlaying) return;
    this.wantPlaying = false;
    this.loadToken++;
    this.clearTimers();
    this.el.pause();
    this.setState('paused');
  }

  private startTick(): void {
    if (this.tickTimer !== undefined) return;
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTick(): void {
    if (this.tickTimer === undefined) return;
    clearInterval(this.tickTimer);
    this.tickTimer = undefined;
  }

  /** Runs in playing and buffering, so a boundary crossed during a stall is still caught. */
  private tick(): void {
    if (!this.wantPlaying) return;
    const pos = this.locate();
    if (pos.trackIdx !== this.currentIdx) {
      this.startLoad();
      return;
    }
    this.emitter.emit('tick', { trackIdx: pos.trackIdx, positionSec: pos.offsetSec });
  }

  private clearTimers(): void {
    this.stopTick();
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    if (this.boundaryTimer !== undefined) clearTimeout(this.boundaryTimer);
    this.retryTimer = undefined;
    this.boundaryTimer = undefined;
  }
}
