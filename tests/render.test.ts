// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine, EngineState, TickEvent } from '../src/audio/AudioEngine';
import type { Manifest } from '../src/core/types';
import { getLocale, setLocale, setLocaleApplier, t } from '../src/i18n/i18n';
import { applyDocumentLang } from '../src/ui/locale';
import { mountPlayer, showBootFailure } from '../src/ui/render';
import { reloadWhenOnline } from '../src/ui/freshManifest';
import { onUpdateClick } from '../src/ui/updatePrompt';

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
    expect($('position').textContent).toBe('');
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

describe('next-up line separators', () => {
  it('separates the label from the title, and the Tibetan title from its English subtitle, with a visible separator', () => {
    ctx.engine.emit('track', 0); // now playing track 0 (EPOCH + 50 s), so next up is track 1
    expect($('nextup').textContent).toBe('Next up: རྟེན་འབྲེལ་དགའ་བསྲུ། / Auspicious Welcome');
  });

  it('every run boundary in the next-up line has a separator, not just a space', () => {
    ctx.engine.emit('track', 0);
    const runs = [...$('nextup').querySelectorAll('span')].map((s) => s.textContent);
    expect(runs).toEqual(['Next up:', 'རྟེན་འབྲེལ་དགའ་བསྲུ།', 'Auspicious Welcome']);
    // The text between the Tibetan run and the English run is the separator.
    expect($('nextup').textContent!.indexOf('/')).toBeGreaterThan(-1);
  });
});

describe('eyebrow comes from the catalogs', () => {
  it('is built from player.live and place.marpoRi through eyebrow.line, in both languages', () => {
    expect($('eyebrow').textContent).toBe(t('eyebrow.line', { live: t('player.live'), place: t('place.marpoRi') }));
    setLocale('bo');
    expect($('eyebrow').textContent).toBe(t('eyebrow.line', { live: t('player.live'), place: t('place.marpoRi') }));
    setLocale('en');
  });

  it('render.ts contains no hard-coded eyebrow copy', () => {
    const src = readFileSync('src/ui/render.ts', 'utf8');
    expect(src).not.toMatch(/ON AIR|MARPO RI/);
  });
});

describe('language toggle label', () => {
  it('the label carries its own language, so the Tibetan label gets the Tibetan treatment', () => {
    expect($('locale').textContent).toBe('བོད་ཡིག');
    expect($('locale').querySelector('span')!.lang).toBe('bo');
    setLocale('bo');
    expect($('locale').textContent).toBe('English');
    expect($('locale').querySelector('span')!.lang).toBe('en');
    setLocale('en');
  });
});

describe('language toggle label span', () => {
  it('the toggle label sits in its own span carrying its language (bo for the Tibetan label)', () => {
    const label = $('locale').querySelector('span');
    expect(label).not.toBeNull();
    expect(label!.lang).toBe('bo');
    expect(label!.textContent).toBe('བོད་ཡིག');
    expect($('locale').lang).toBe('en'); // the button itself stays in the UI language
  });

  it('after a switch, the span carries the new label language', () => {
    $('locale').click();
    const label = $('locale').querySelector('span');
    expect(label!.lang).toBe('en');
    expect(label!.textContent).toBe('English');
    setLocale('en');
  });
});

describe('footer line (catalog, own lang span)', () => {
  it('the footer text is the catalog string, in a span tagged with the UI language', () => {
    const span = $('footer').querySelector('span')!;
    expect(span.textContent).toBe(t('footer.line'));
    expect(span.lang).toBe('en');
  });

  it('in Tibetan mode the footer is the Tibetan catalog string, tagged bo', () => {
    setLocale('bo');
    const span = $('footer').querySelector('span')!;
    expect(span.textContent).toBe(t('footer.line'));
    expect(span.lang).toBe('bo');
    setLocale('en');
  });
});

describe('artwork in the ring', () => {
  const ART_A = 'https://cdn.test/art/a.jpg';
  const ART_B = 'https://cdn.test/art/b.jpg';
  function remountWithArt(a: string | undefined, b: string | undefined): void {
    const manifest = { ...REAL, tracks: [{ ...REAL.tracks[0]!, artwork: a }, { ...REAL.tracks[1]!, artwork: b }] };
    ctx.player.unmount();
    mountSkeleton();
    const engine = new FakeEngine();
    const player = mountPlayer({ engine: engine as unknown as AudioEngine, manifest, now: () => EPOCH_MS + 50_000, offline: () => false });
    ctx = { engine, player };
  }

  it('the image has intrinsic size and async decoding, and is neither lazy nor preloaded', () => {
    const img = $<HTMLImageElement>('artwork');
    expect(img.getAttribute('width')).toBe('512');
    expect(img.getAttribute('height')).toBe('512');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.hasAttribute('loading')).toBe(false);
    expect(readFileSync('index.html', 'utf8')).not.toMatch(/rel="preload"[^>]*(artwork|\/art\/)/);
  });

  it('the source is the current track artwork, hidden until it loads, then shown', () => {
    remountWithArt(ART_A, ART_B);
    expect($('artwork').getAttribute('src')).toBe(ART_A);
    expect($('artwork').hidden).toBe(true);
    $('artwork').dispatchEvent(new Event('load'));
    expect($('artwork').hidden).toBe(false);
  });

  it('a track without artwork hides the image and drops the source (no broken-image icon)', () => {
    expect($('artwork').hidden).toBe(true);
    expect($('artwork').hasAttribute('src')).toBe(false);
  });

  it('a failing image is hidden, so the ring stays and nothing shifts visibly', () => {
    remountWithArt('https://cdn.test/art/broken.jpg', undefined);
    $('artwork').dispatchEvent(new Event('error'));
    expect($('artwork').hidden).toBe(true);
    expect(document.querySelector('svg.ring')).not.toBeNull();
  });

  it('a repaint with the same URL is a no-op: a failed image stays hidden after a locale change', () => {
    remountWithArt(ART_A, ART_B);
    $('artwork').dispatchEvent(new Event('error'));
    setLocale('bo');
    expect($('artwork').hidden).toBe(true);
    expect($('artwork').getAttribute('src')).toBe(ART_A);
  });

  it('a repaint with the same URL keeps a loaded image visible (no flash)', () => {
    remountWithArt(ART_A, ART_B);
    $('artwork').dispatchEvent(new Event('load'));
    setLocale('bo');
    expect($('artwork').hidden).toBe(false);
  });

  it('a new URL hides the image again until it loads', () => {
    remountWithArt(ART_A, ART_B);
    $('artwork').dispatchEvent(new Event('load'));
    ctx.engine.emit('track', 1);
    expect($('artwork').getAttribute('src')).toBe(ART_B);
    expect($('artwork').hidden).toBe(true);
    $('artwork').dispatchEvent(new Event('load'));
    expect($('artwork').hidden).toBe(false);
  });

  it('a new URL after a failure gets a fresh chance', () => {
    remountWithArt(ART_A, ART_B);
    $('artwork').dispatchEvent(new Event('error'));
    ctx.engine.emit('track', 1);
    $('artwork').dispatchEvent(new Event('load'));
    expect($('artwork').hidden).toBe(false);
  });

  it('a load event that arrives after the track lost its artwork does not show the image', () => {
    remountWithArt(ART_A, undefined);
    ctx.engine.emit('track', 1);
    $('artwork').dispatchEvent(new Event('load'));
    expect($('artwork').hidden).toBe(true);
  });

  it('unmount removes the load listener', () => {
    remountWithArt(ART_A, ART_B);
    ctx.player.unmount();
    $('artwork').dispatchEvent(new Event('load'));
    expect($('artwork').hidden).toBe(true);
  });
});

describe('kora ring state (M9)', () => {
  it('the halo is marked active while loading, playing or buffering, and not while idle, paused or in error', () => {
    const halo = document.querySelector('.halo')!;
    expect(halo.hasAttribute('data-active')).toBe(false);
    for (const s of ['loading', 'playing', 'buffering'] as const) {
      ctx.engine.emit('state', s);
      expect(halo.hasAttribute('data-active'), s).toBe(true);
    }
    for (const s of ['paused', 'error', 'idle'] as const) {
      ctx.engine.emit('state', s);
      expect(halo.hasAttribute('data-active'), s).toBe(false);
    }
  });

  it('the ring stays hidden from assistive technology in both states', () => {
    ctx.engine.emit('state', 'playing');
    expect(document.querySelector('svg.ring')!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('footer caps (M9)', () => {
  it('the footer carries the caps class and the English catalog text is sentence case (CSS uppercases it)', () => {
    expect($('footer').classList.contains('caps')).toBe(true);
    expect($('footer').querySelector('span')!.textContent).toBe('Marpo Ri · 3,700 m · 1645');
  });
});

describe('presence badge', () => {
  // Minimal presence stand-in: the renderer only needs onChange().
  function presenceStub() {
    let cb: ((c: { state: string; count: number | null }) => void) | null = null;
    let unsubscribed = 0;
    return {
      onChange(fn: (c: { state: string; count: number | null }) => void) {
        cb = fn;
        return () => {
          unsubscribed++;
          cb = null;
        };
      },
      emit(c: { state: string; count: number | null }) {
        cb?.(c);
      },
      get unsubscribed() {
        return unsubscribed;
      },
    };
  }

  function remount(presence?: ReturnType<typeof presenceStub>) {
    ctx.player.unmount();
    mountSkeleton();
    const engine = new FakeEngine();
    const player = mountPlayer({
      engine: engine as unknown as AudioEngine,
      manifest: REAL,
      now: () => EPOCH_MS + 50_000,
      offline: () => false,
      presence: presence as never,
    });
    ctx = { engine, player };
  }

  it('without presence the badge shows the catalog placeholder, never a number', () => {
    expect($('badge').textContent).toBe('—');
  });

  it('while watching with a count, the badge shows the catalog line with the count', () => {
    const p = presenceStub();
    remount(p);
    p.emit({ state: 'watching', count: 3 });
    expect($('badge').textContent).toBe('3 on the kora');
  });

  it('counts are grouped with Western digits', () => {
    const p = presenceStub();
    remount(p);
    p.emit({ state: 'listening', count: 1234 });
    expect($('badge').textContent).toBe('1,234 on the kora');
  });

  it('connecting, backoff and offline all show the placeholder, even if a stale count is present', () => {
    const p = presenceStub();
    remount(p);
    p.emit({ state: 'connecting', count: 9 });
    expect($('badge').textContent).toBe('—');
    p.emit({ state: 'backoff', count: 9 });
    expect($('badge').textContent).toBe('—');
    p.emit({ state: 'offline', count: 9 });
    expect($('badge').textContent).toBe('—');
  });

  it('the dot is live only while the badge shows a real count, never with the placeholder', () => {
    const dot = document.querySelector('.dot')!;
    expect(dot.hasAttribute('data-live')).toBe(false);
    const p = presenceStub();
    remount(p);
    const liveDot = document.querySelector('.dot')!;
    expect(liveDot.hasAttribute('data-live')).toBe(false);
    p.emit({ state: 'watching', count: 2 });
    expect(liveDot.hasAttribute('data-live')).toBe(true);
    p.emit({ state: 'backoff', count: 2 });
    expect($('badge').textContent).toBe('—');
    expect(liveDot.hasAttribute('data-live')).toBe(false);
    p.emit({ state: 'listening', count: null });
    expect(liveDot.hasAttribute('data-live')).toBe(false);
  });

  it('the dot stays hidden from assistive technology', () => {
    expect(document.querySelector('.dot')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('unmount unsubscribes from presence', () => {
    const p = presenceStub();
    remount(p);
    ctx.player.unmount();
    expect(p.unsubscribed).toBe(1);
  });
});

// ---- M8: update prompt, boot failure, fresh track manifest after an offline boot ----------------------

describe('update prompt button', () => {
  it('is a button; a click calls apply and never touches the engine', () => {
    const apply = vi.fn();
    const off = onUpdateClick(apply);
    ctx.player.showUpdate();
    const btn = $<HTMLButtonElement>('update');
    expect(btn.tagName).toBe('BUTTON');
    btn.click();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(ctx.engine.pause).not.toHaveBeenCalled();
    expect(ctx.engine.play).not.toHaveBeenCalled();
    off();
    btn.click();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('shows the Tibetan catalog text when the UI is bo', () => {
    setLocale('bo');
    ctx.player.showUpdate();
    expect($('update').textContent).toBe(t('update.available'));
    expect($('update').textContent).toMatch(/[ༀ-࿿]/);
  });
});

describe('boot failure (no track manifest at all)', () => {
  it('offline: shows player.offline, the brand, and an inert play button; no fake numbers', () => {
    ctx.player.unmount();
    mountSkeleton();
    showBootFailure(true);
    expect($('status').textContent).toBe(t('player.offline'));
    expect($('station').textContent).toContain('Gorshey');
    const play = $<HTMLButtonElement>('play');
    expect(play.disabled).toBe(true);
    expect(play.textContent).toBe(t('player.play'));
    expect($('badge').textContent).toBe('—');
    expect($('title').textContent).toBe('—');
  });

  it('online: shows player.error instead', () => {
    ctx.player.unmount();
    mountSkeleton();
    showBootFailure(false);
    expect($('status').textContent).toBe(t('player.error'));
  });
});

describe('reloadWhenOnline (booted on the cached track manifest)', () => {
  function engineIn(state: EngineState): FakeEngine {
    const e = new FakeEngine();
    e.state = state;
    return e;
  }

  it.each<EngineState>(['idle', 'paused', 'error'])('reloads once when online returns and the engine is %s', (state) => {
    const reload = vi.fn();
    const off = reloadWhenOnline({ engine: engineIn(state) as unknown as AudioEngine, reload });
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    expect(reload).toHaveBeenCalledTimes(1);
    off();
  });

  it.each<EngineState>(['playing', 'buffering', 'loading'])('never reloads while the engine is %s', (state) => {
    const reload = vi.fn();
    const engine = engineIn(state);
    const off = reloadWhenOnline({ engine: engine as unknown as AudioEngine, reload });
    window.dispatchEvent(new Event('online'));
    engine.emit('state', state === 'playing' ? 'buffering' : 'playing');
    engine.emit('state', state);
    expect(reload).not.toHaveBeenCalled();
    off();
  });

  it('online while playing, then paused: reloads at the pause, once', () => {
    const reload = vi.fn();
    const engine = engineIn('playing');
    const off = reloadWhenOnline({ engine: engine as unknown as AudioEngine, reload });
    window.dispatchEvent(new Event('online'));
    expect(reload).not.toHaveBeenCalled();
    engine.emit('state', 'paused');
    engine.emit('state', 'error');
    expect(reload).toHaveBeenCalledTimes(1);
    off();
  });

  it('a state change without an online event never reloads', () => {
    const reload = vi.fn();
    const engine = engineIn('idle');
    const off = reloadWhenOnline({ engine: engine as unknown as AudioEngine, reload });
    engine.emit('state', 'paused');
    expect(reload).not.toHaveBeenCalled();
    off();
  });

  it('after unsubscribe, online does nothing', () => {
    const reload = vi.fn();
    const off = reloadWhenOnline({ engine: engineIn('idle') as unknown as AudioEngine, reload });
    off();
    window.dispatchEvent(new Event('online'));
    expect(reload).not.toHaveBeenCalled();
  });
});
