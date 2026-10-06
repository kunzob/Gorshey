// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine, EngineState, TickEvent } from '../src/audio/AudioEngine';
import type { Manifest } from '../src/core/types';
import { getLocale, setLocale, setLocaleApplier } from '../src/i18n/i18n';
import { applyDocumentLang } from '../src/ui/locale';
import { mountPlayer } from '../src/ui/render';

const EPOCH_MS = Date.parse('2026-01-01T00:00:00Z');
const REAL: Manifest = {
  version: '5166db301c24',
  epoch: '2026-01-01T00:00:00Z',
  epochMs: EPOCH_MS,
  totalDuration: 456.434688,
  tracks: [
    {
      id: 'bd4e9fd47041',
      title: { bo: 'མ་ནི་ཡིག་དྲུག', en: 'Song of Mani' },
      artist: { bo: 'མིང་མེད', en: 'Unknown' },
      duration: 211.255167,
      src: 'a',
    },
    {
      id: '283d75d6d29d',
      title: { bo: 'རྟེན་འབྲེལ་དགའ་བསྲུ།', en: 'Auspicious Welcome' },
      artist: { bo: 'མིང་མེད', en: 'Unknown' },
      duration: 245.179521,
      src: 'b',
    },
  ],
};

type Handler = (payload: never) => void;

/** Stand-in for AudioEngine: the shell only uses state, on(), play(), pause(), onVisible() and destroy(). */
class FakeEngine {
  state: EngineState = 'idle';
  private handlers = new Map<string, Set<Handler>>();
  play = vi.fn(() => {});
  pause = vi.fn(() => {});
  onVisible = vi.fn(() => {});
  destroy = vi.fn(() => {});

  on(event: string, cb: Handler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(cb);
    return () => this.handlers.get(event)!.delete(cb);
  }

  emit(event: 'state', s: EngineState): void;
  emit(event: 'track', idx: number): void;
  emit(event: 'tick', t: TickEvent): void;
  emit(event: string, payload: unknown): void {
    if (event === 'state') this.state = payload as EngineState;
    for (const cb of this.handlers.get(event) ?? []) (cb as (p: unknown) => void)(payload);
  }
}

// The skeleton is the real index.html body, without the module script (it would boot the app).
function mountSkeleton(): void {
  const html = readFileSync('index.html', 'utf8');
  const body = html.replace(/^[\s\S]*<body>/, '').replace(/<\/body>[\s\S]*$/, '');
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/, '');
}

const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;

interface Ctx {
  engine: FakeEngine;
  player: ReturnType<typeof mountPlayer>;
}
let ctx: Ctx;

function start(offlineNow = false): Ctx {
  mountSkeleton();
  const engine = new FakeEngine();
  const player = mountPlayer({
    engine: engine as unknown as AudioEngine,
    manifest: REAL,
    now: () => EPOCH_MS + 50_000,
    offline: () => offlineNow,
  });
  return { engine, player };
}

beforeEach(() => {
  setLocaleApplier(applyDocumentLang);
  setLocale('en');
  localStorage.clear();
  ctx = start();
});

afterEach(() => {
  ctx.player.unmount();
  setLocale('en');
  localStorage.clear();
});

describe('textContent only, and lang runs', () => {
  it('the brand mark is two spans: Latin (lang en) and Tibetan (lang bo)', () => {
    const spans = [...$('station').querySelectorAll('span')];
    expect(spans.map((s) => s.lang)).toEqual(['en', 'bo']);
    expect(spans[0]!.textContent).toContain('Gorshey');
    expect(spans[1]!.textContent).toBe('སྒོར་གཞས།');
  });

  it('the title is the Tibetan original in a lang="bo" span, and the subtitle is English in a lang="en" span', () => {
    ctx.engine.emit('track', 0);
    const title = $('title').querySelector('span')!;
    const subtitle = $('subtitle').querySelector('span')!;
    expect(title.lang).toBe('bo');
    expect(title.textContent).toBe('མ་ནི་ཡིག་དྲུག');
    expect(subtitle.lang).toBe('en');
    expect(subtitle.textContent).toBe('Song of Mani');
  });

  it('a track title with markup-looking text is shown as text, never parsed as HTML', () => {
    const evil = { bo: '<img src=x onerror="alert(1)">', en: '<b>Bold</b>' };
    const manifest = { ...REAL, tracks: [{ ...REAL.tracks[0]!, title: evil }] };
    ctx.player.unmount();
    mountSkeleton();
    const engine = new FakeEngine();
    const player = mountPlayer({ engine: engine as unknown as AudioEngine, manifest, now: () => EPOCH_MS, offline: () => false });
    ctx = { engine, player };
    expect($('title').querySelector('img')).toBeNull();
    expect($('subtitle').querySelector('b')).toBeNull();
    expect($('subtitle').textContent).toBe('<b>Bold</b>');
  });

  it('the eyebrow reads from the catalogs (ON AIR · MARPO RI)', () => {
    expect($('eyebrow').textContent).toBe('ON AIR · MARPO RI');
  });
});

describe('single lang writer', () => {
  it('the applier sets document lang when the locale changes', () => {
    setLocale('bo');
    expect(document.documentElement.lang).toBe('bo');
    setLocale('en');
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('status line (aria-live)', () => {
  it('the status region is polite and empty while playing', () => {
    expect($('status').getAttribute('aria-live')).toBe('polite');
    ctx.engine.emit('state', 'playing');
    expect($('status').textContent).toBe('');
  });

  it('shows buffering, then error, from the catalog', () => {
    ctx.engine.emit('state', 'buffering');
    expect($('status').textContent).toBe('Buffering…');
    ctx.engine.emit('state', 'error');
    expect($('status').textContent).toBe('Playback failed. Try again.');
  });

  it('shows offline when the network is down, and it outranks the engine state', () => {
    ctx.player.unmount();
    mountSkeleton();
    const engine = new FakeEngine();
    const player = mountPlayer({ engine: engine as unknown as AudioEngine, manifest: REAL, now: () => EPOCH_MS, offline: () => true });
    ctx = { engine, player };
    engine.emit('state', 'error');
    expect($('status').textContent).toBe('You are offline.');
  });
});

describe('kora ring', () => {
  it('is hidden from assistive technology', () => {
    expect(document.querySelector('svg.ring')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('its fill follows the engine tick position, not the audio element', () => {
    ctx.engine.emit('state', 'playing');
    ctx.engine.emit('tick', { trackIdx: 0, positionSec: 105.6275835 }); // half of track 0
    const circumference = 2 * Math.PI * 45;
    const offset = parseFloat($('ring-fill').style.strokeDashoffset);
    expect(offset).toBeCloseTo(circumference / 2, 0);
  });
});

describe('play button and position', () => {
  it('the label comes from the catalog and follows the engine state', () => {
    expect($('play').textContent).toBe('Play');
    ctx.engine.emit('state', 'playing');
    expect($('play').textContent).toBe('Pause');
  });

  it('a click while playing pauses, and a click while paused plays', () => {
    ctx.engine.emit('state', 'playing');
    $('play').click();
    expect(ctx.engine.pause).toHaveBeenCalledOnce();
    ctx.engine.emit('state', 'paused');
    $('play').click();
    expect(ctx.engine.play).toHaveBeenCalledOnce();
  });

  it('shows position over duration with Western digits while active, and the empty string otherwise', () => {
    expect($('position').textContent).toBe('—');
    ctx.engine.emit('state', 'playing');
    ctx.engine.emit('tick', { trackIdx: 0, positionSec: 72.4 });
    expect($('position').textContent).toBe('1:12 / 3:31');
  });
});

describe('locale toggle', () => {
  it('shows the other locale label, and a click switches the text and persists the choice', () => {
    expect($('locale').textContent).toBe('བོད་ཡིག');
    $('locale').click();
    expect(getLocale()).toBe('bo');
    expect($('locale').textContent).toBe('English');
    expect($('eyebrow').textContent).toContain('ཐད་ཀར་ཡོད།');
    expect(localStorage.getItem('gorshey.locale')).toBe('bo');
  });

  it('the Tibetan UI keeps the title Tibetan (lang bo) with the English subtitle', () => {
    setLocale('bo');
    ctx.engine.emit('track', 0);
    expect($('title').querySelector('span')!.lang).toBe('bo');
    expect($('subtitle').querySelector('span')!.lang).toBe('en');
  });
});

describe('update slot', () => {
  it('stays hidden until an update is announced, then shows the catalog text', () => {
    expect($('update').hidden).toBe(true);
    ctx.player.showUpdate();
    expect($('update').hidden).toBe(false);
    expect($('update').textContent).toBe('A new version is available. Reload when you are ready.');
  });
});

describe('unmount', () => {
  it('removes the engine subscriptions: later events change nothing', () => {
    ctx.player.unmount();
    ctx.engine.emit('state', 'error');
    expect($('status').textContent).toBe('');
  });
});
