import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Presence, type PresenceOptions, type PresenceTransport } from '../src/presence/presence';

// Fake transport: records calls and lets the test deliver status and sync events. No network.
class FakeTransport implements PresenceTransport {
  onStatus: ((s: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED') => void) | null = null;
  onSync: ((keys: string[]) => void) | null = null;
  tracks: Array<Record<string, unknown>> = [];
  untracks = 0;
  closed = false;
  subscribed = false;
  subscribe(onStatus: (s: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED') => void, onSync: (keys: string[]) => void): void {
    this.subscribed = true;
    this.onStatus = onStatus;
    this.onSync = onSync;
  }
  track(payload: Record<string, unknown>): void {
    this.tracks.push(payload);
  }
  untrack(): void {
    this.untracks++;
  }
  close(): void {
    this.closed = true;
  }
  status(s: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'): void {
    this.onStatus?.(s);
  }
  sync(keys: string[]): void {
    this.onSync?.(keys);
  }
}

// Manual time that moves with the fake timers, so the injected now() and setTimeout agree.
let t = 0;
let transports: FakeTransport[];
let online: boolean;

function make(overrides: Partial<PresenceOptions> = {}): Presence {
  return new Presence({
    now: () => t,
    createTransport: () => {
      const tr = new FakeTransport();
      transports.push(tr);
      return tr;
    },
    isOnline: () => online,
    random: () => 0.5, // no jitter
    ...overrides,
  });
}

function advance(ms: number): void {
  t += ms;
  vi.advanceTimersByTime(ms);
}

const last = (): FakeTransport => transports[transports.length - 1]!;

beforeEach(() => {
  vi.useFakeTimers();
  t = 0;
  transports = [];
  online = true;
});
afterEach(() => vi.useRealTimers());

describe('no socket before the first play', () => {
  it('constructing and waiting creates no transport and opens no socket', () => {
    const p = make();
    advance(60_000);
    expect(transports).toHaveLength(0);
    expect(p.state).toBe('idle');
  });

  it('the first setListening(true) is the first connection', () => {
    const p = make();
    p.setListening(true);
    expect(transports).toHaveLength(1);
    expect(p.state).toBe('connecting');
  });
});

describe('connecting and tracking', () => {
  it('SUBSCRIBED while listening sends track() once', () => {
    const p = make();
    p.setListening(true);
    last().status('SUBSCRIBED');
    expect(p.state).toBe('listening');
    expect(last().tracks).toEqual([{ listening: true }]);
  });

  it('pausing untracks and keeps the socket, so the count stays live (watching)', () => {
    const p = make();
    p.setListening(true);
    last().status('SUBSCRIBED');
    advance(1000);
    p.setListening(false);
    advance(1000);
    expect(last().untracks).toBe(1);
    expect(last().closed).toBe(false);
    expect(p.state).toBe('watching');
  });

  it('the count is the number of unique keys in sync', () => {
    const p = make();
    p.setListening(true);
    last().status('SUBSCRIBED');
    last().sync(['a', 'a', 'b']);
    expect(p.count).toBe(2);
  });
});

describe('connection failure and backoff', () => {
  it('CHANNEL_ERROR moves to backoff and retries after 1 s, then 2 s', () => {
    const p = make();
    p.setListening(true);
    last().status('CHANNEL_ERROR');
    expect(p.state).toBe('backoff');
    advance(999);
    expect(transports).toHaveLength(1);
    advance(1);
    expect(transports).toHaveLength(2);
    last().status('CHANNEL_ERROR');
    advance(1999);
    expect(transports).toHaveLength(2);
    advance(1);
    expect(transports).toHaveLength(3);
  });

  it('an unexpected CLOSED is a failure too', () => {
    const p = make();
    p.setListening(true);
    last().status('SUBSCRIBED');
    last().status('CLOSED');
    expect(p.state).toBe('backoff');
  });

  it('after a reconnect, track() is sent again if the tab is still listening', () => {
    const p = make();
    p.setListening(true);
    last().status('SUBSCRIBED');
    last().status('CLOSED');
    advance(1000);
    last().status('SUBSCRIBED');
    expect(last().tracks).toEqual([{ listening: true }]);
  });

  it('a reconnect while paused does not track', () => {
    const p = make();
    p.setListening(true);
    last().status('SUBSCRIBED');
    p.setListening(false);
    last().status('CLOSED');
    advance(1000);
    last().status('SUBSCRIBED');
    expect(transports[0]!.tracks).toEqual([{ listening: true }]); // the original track, never a second one
    expect(last().tracks).toEqual([]); // the reconnected socket sends nothing while paused
  });
});

describe('timeout', () => {
  it('no SUBSCRIBED within 10 s moves to backoff', () => {
    const p = make();
    p.setListening(true);
    advance(9_999);
    expect(p.state).toBe('connecting');
    advance(1);
    expect(p.state).toBe('backoff');
  });

  it('a SUBSCRIBED that arrives after the timeout is ignored (the old socket is closed)', () => {
    const p = make();
    p.setListening(true);
    advance(10_000);
    const stale = transports[0]!;
    stale.status('SUBSCRIBED');
    expect(stale.closed).toBe(true);
    expect(p.state).toBe('backoff');
  });
});

describe('offline', () => {
  it('the offline event stops all attempts and clears timers', () => {
    const p = make();
    p.setListening(true);
    last().status('CHANNEL_ERROR');
    p.onOffline();
    expect(p.state).toBe('offline');
    advance(60_000);
    expect(transports).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the online event reconnects at once', () => {
    const p = make();
    p.setListening(true);
    last().status('CHANNEL_ERROR');
    p.onOffline();
    online = true;
    p.onOnline();
    expect(transports).toHaveLength(2);
    expect(p.state).toBe('connecting');
  });
});

describe('burst of joins and leaves', () => {
  it('rapid toggles coalesce: only the last intent is sent', () => {
    const p = make({ coalesceMs: 1000 });
    p.setListening(true);
    last().status('SUBSCRIBED');
    for (let i = 0; i < 20; i++) {
      p.setListening(i % 2 === 0 ? false : true);
      advance(10);
    }
    p.setListening(false);
    advance(1000);
    expect(last().untracks).toBe(1);
    expect(last().tracks).toHaveLength(1);
  });

  it('never more than 5 presence calls in any 30 s window (the configured bucket)', () => {
    const p = make({ coalesceMs: 0, maxCalls: 5, windowMs: 30_000 });
    p.setListening(true);
    last().status('SUBSCRIBED'); // the track() on subscribe is call 1 of the window
    for (let i = 0; i < 30; i++) {
      p.setListening(i % 2 === 0 ? false : true);
      advance(1000);
    }
    expect(last().tracks.length + last().untracks).toBeLessThanOrEqual(5);
  });

  it('the final state after a burst matches the last intent', () => {
    const p = make({ coalesceMs: 0, maxCalls: 5, windowMs: 30_000 });
    p.setListening(true);
    last().status('SUBSCRIBED');
    for (let i = 0; i < 12; i++) {
      p.setListening(i % 2 === 0);
      advance(100);
    }
    p.setListening(false);
    advance(60_000);
    expect(p.state).toBe('watching');
  });

  it('the bucket size is a configurable constant, not hard-coded', () => {
    const p = make({ coalesceMs: 0, maxCalls: 2, windowMs: 30_000 });
    p.setListening(true);
    last().status('SUBSCRIBED');
    for (let i = 0; i < 10; i++) {
      p.setListening(i % 2 === 0);
      advance(10);
    }
    expect(last().tracks.length + last().untracks).toBeLessThanOrEqual(2);
  });
});

describe('leave and destroy', () => {
  it('pagehide leaves the channel: untrack, close, and no timers', () => {
    const p = make();
    p.setListening(true);
    last().status('SUBSCRIBED');
    p.leave();
    expect(last().closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(p.state).toBe('idle');
  });

  it('destroy() is terminal: later intents do nothing', () => {
    const p = make();
    p.setListening(true);
    last().status('SUBSCRIBED');
    p.destroy();
    p.setListening(true);
    advance(60_000);
    expect(transports).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a sync after destroy is ignored (no count is emitted)', () => {
    const p = make();
    const seen: Array<number | null> = [];
    p.onChange((c) => seen.push(c.count));
    p.setListening(true);
    last().status('SUBSCRIBED');
    p.destroy();
    last().sync(['a', 'b']);
    expect(seen.includes(2)).toBe(false);
  });
});

describe('failure isolation and config', () => {
  it('a transport that throws never reaches the caller', () => {
    const p = make({
      createTransport: () => {
        throw new Error('socket exploded');
      },
    });
    expect(() => p.setListening(true)).not.toThrow();
    expect(p.state).toBe('backoff');
  });

  it('no config means disabled: no transport and the badge shows the placeholder', () => {
    const p = make({ createTransport: () => null as unknown as PresenceTransport });
    p.setListening(true);
    expect(p.state).toBe('disabled');
    expect(transports).toHaveLength(0);
  });

  it('onChange emits state and count, and returns an unsubscribe function', () => {
    const p = make();
    const seen: string[] = [];
    const off = p.onChange((c) => seen.push(c.state));
    p.setListening(true);
    off();
    last().status('SUBSCRIBED');
    expect(seen).toEqual(['connecting']);
  });
});
