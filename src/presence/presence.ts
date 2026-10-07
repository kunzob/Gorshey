// Presence state machine. Connects on the first play, never at boot. Presence is decoration:
// no path here blocks or touches playback. Time comes from the injected now() (clock.now in the app).
import { backoffDelay } from './backoff';

export type PresenceState = 'disabled' | 'idle' | 'connecting' | 'listening' | 'watching' | 'backoff' | 'offline';
type Status = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

export interface PresenceTransport {
  subscribe(onStatus: (s: Status) => void, onSync: (keys: string[]) => void): void;
  track(payload: Record<string, unknown>): void;
  untrack(): void;
  close(): void;
}

export interface PresenceOptions {
  now: () => number;
  /** Returns null when presence is not configured. */
  createTransport: () => PresenceTransport | null;
  isOnline: () => boolean;
  random?: () => number;
  /** Free tier: 5 presence calls per client per 30 s (docs table row). Configurable, not assumed. */
  maxCalls?: number;
  windowMs?: number;
  coalesceMs?: number;
  subscribeTimeoutMs?: number;
}

const DEFAULT_MAX_CALLS = 5;
const DEFAULT_WINDOW_MS = 30_000;
const DEFAULT_COALESCE_MS = 1000;
const DEFAULT_SUBSCRIBE_TIMEOUT_MS = 10_000;

export interface PresenceChange {
  state: PresenceState;
  count: number | null;
}

export class Presence {
  private readonly now: () => number;
  private readonly createTransport: () => PresenceTransport | null;
  private readonly isOnline: () => boolean;
  private readonly random: () => number;
  private readonly maxCalls: number;
  private readonly windowMs: number;
  private readonly coalesceMs: number;
  private readonly subscribeTimeoutMs: number;

  private _state: PresenceState = 'idle';
  private _count: number | null = null;
  private transport: PresenceTransport | null = null;
  private wantListening = false;
  private serverTracked = false;
  private attempt = 0;
  private destroyed = false;
  private calls: number[] = [];
  private timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  private backoffTimer: ReturnType<typeof setTimeout> | undefined;
  private coalesceTimer: ReturnType<typeof setTimeout> | undefined;
  private bucketTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<(c: PresenceChange) => void>();

  constructor(opts: PresenceOptions) {
    this.now = opts.now;
    this.createTransport = opts.createTransport;
    this.isOnline = opts.isOnline;
    this.random = opts.random ?? Math.random;
    this.maxCalls = opts.maxCalls ?? DEFAULT_MAX_CALLS;
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.coalesceMs = opts.coalesceMs ?? DEFAULT_COALESCE_MS;
    this.subscribeTimeoutMs = opts.subscribeTimeoutMs ?? DEFAULT_SUBSCRIBE_TIMEOUT_MS;
  }

  get state(): PresenceState {
    return this._state;
  }

  get count(): number | null {
    return this._count;
  }

  onChange(cb: (c: PresenceChange) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Called by the audio layer on play (true) and pause, error or ended (false). */
  setListening(on: boolean): void {
    if (this.destroyed || this._state === 'disabled') return;
    try {
      this.wantListening = on;
      if (!this.transport && on) {
        this.connect();
      } else if (this.transport) {
        if (this._state === 'listening' || this._state === 'watching') this.setState(on ? 'listening' : 'watching');
        this.scheduleIntent(this.coalesceMs);
      }
    } catch {
      this.failTransport();
    }
  }

  onOffline(): void {
    if (this.destroyed || this._state === 'disabled') return;
    this.clearTimers();
    this.dropTransport();
    this.setState('offline');
  }

  onOnline(): void {
    if (this.destroyed || this._state !== 'offline') return;
    this.attempt = 0;
    this.connect();
  }

  /** pagehide: leave the channel, clear timers, no reconnects. */
  leave(): void {
    this.clearTimers();
    this.dropTransport();
    this.wantListening = false;
    this.setCount(null);
    this.setState('idle');
  }

  /** Terminal. Later intents and syncs do nothing. */
  destroy(): void {
    this.leave();
    this.destroyed = true;
    this.listeners.clear();
  }

  // ---- internals ------------------------------------------------------------------------

  private connect(): void {
    if (!this.isOnline()) {
      this.setState('offline');
      return;
    }
    let tr: PresenceTransport | null;
    try {
      tr = this.createTransport();
    } catch {
      this.scheduleBackoff();
      return;
    }
    if (tr === null) {
      this.setState('disabled');
      return;
    }
    this.transport = tr;
    this.serverTracked = false;
    this.setState('connecting');
    this.timeoutTimer = setTimeout(() => this.onTimeout(tr), this.subscribeTimeoutMs);
    tr.subscribe(
      (s) => this.onStatus(tr, s),
      (keys) => this.onSync(tr, keys),
    );
  }

  private onStatus(tr: PresenceTransport, s: Status): void {
    if (tr !== this.transport || this.destroyed) return; // stale socket
    if (s === 'SUBSCRIBED') {
      clearTimeout(this.timeoutTimer);
      this.attempt = 0;
      this.setState(this.wantListening ? 'listening' : 'watching');
      this.flush();
      return;
    }
    this.failTransport();
  }

  private onSync(tr: PresenceTransport, keys: string[]): void {
    if (tr !== this.transport || this.destroyed) return;
    this.setCount(new Set(keys).size);
  }

  private onTimeout(tr: PresenceTransport): void {
    if (tr !== this.transport) return;
    this.failTransport();
  }

  private failTransport(): void {
    clearTimeout(this.timeoutTimer);
    this.dropTransport();
    this.scheduleBackoff();
  }

  private scheduleBackoff(): void {
    clearTimeout(this.backoffTimer);
    this.setState('backoff');
    const delay = backoffDelay(this.attempt, this.random);
    this.attempt++;
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = undefined;
      if (!this.destroyed) this.connect();
    }, delay);
  }

  private dropTransport(): void {
    const tr = this.transport;
    this.transport = null;
    this.serverTracked = false;
    try {
      tr?.close();
    } catch {
      // closing a dead socket can throw; nothing to recover
    }
  }

  /** Coalesce toggles: the latest intent wins after `delay` ms. */
  private scheduleIntent(delay: number): void {
    clearTimeout(this.coalesceTimer);
    this.coalesceTimer = setTimeout(() => {
      this.coalesceTimer = undefined;
      this.flush();
    }, delay);
  }

  /** Sends the wanted tracked state, within `maxCalls` per `windowMs`. */
  private flush(): void {
    if (!this.transport || (this._state !== 'listening' && this._state !== 'watching')) return;
    const want = this.wantListening;
    if (want === this.serverTracked) return;
    const now = this.now();
    this.calls = this.calls.filter((ts) => now - ts < this.windowMs);
    if (this.calls.length >= this.maxCalls) {
      const wait = this.calls[0]! + this.windowMs - now;
      clearTimeout(this.bucketTimer);
      this.bucketTimer = setTimeout(() => {
        this.bucketTimer = undefined;
        this.flush();
      }, Math.max(0, wait));
      return;
    }
    const tr = this.transport;
    if (want) tr.track({ listening: true });
    else tr.untrack();
    this.serverTracked = want;
    this.calls.push(now);
  }

  private clearTimers(): void {
    clearTimeout(this.timeoutTimer);
    clearTimeout(this.backoffTimer);
    clearTimeout(this.coalesceTimer);
    clearTimeout(this.bucketTimer);
    this.timeoutTimer = undefined;
    this.backoffTimer = undefined;
    this.coalesceTimer = undefined;
    this.bucketTimer = undefined;
  }

  private setState(next: PresenceState): void {
    if (this._state === next) return;
    this._state = next;
    this.emit();
  }

  private setCount(next: number | null): void {
    if (this._count === next) return;
    this._count = next;
    this.emit();
  }

  private emit(): void {
    const change: PresenceChange = { state: this._state, count: this._count };
    this.listeners.forEach((cb) => cb(change));
  }
}
