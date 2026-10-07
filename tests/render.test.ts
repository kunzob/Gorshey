// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine, EngineState, TickEvent } from '../src/audio/AudioEngine';
import type { Manifest } from '../src/core/types';
import { getLocale, setLocale, setLocaleApplier, t } from '../src/i18n/i18n';
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
    expect(span.textContent).toBe('MARPO RI · 3,700 M · 1645');
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
  it('the image source is the current track artwork from the manifest', () => {
    const manifest = { ...REAL, tracks: [{ ...REAL.tracks[0]!, artwork: 'https://cdn.test/art/a.jpg' }, REAL.tracks[1]!] };
    ctx.player.unmount();
    mountSkeleton();
    const engine = new FakeEngine();
    const player = mountPlayer({ engine: engine as unknown as AudioEngine, manifest, now: () => EPOCH_MS + 50_000, offline: () => false });
    ctx = { engine, player };
    expect($('artwork').getAttribute('src')).toBe('https://cdn.test/art/a.jpg');
    expect($('artwork').hidden).toBe(false);
  });

  it('a track without artwork hides the image (no broken-image icon)', () => {
    expect($('artwork').hidden).toBe(true);
  });

  it('a failing image is hidden, so the ring stays and nothing shifts visibly', () => {
    const manifest = { ...REAL, tracks: [{ ...REAL.tracks[0]!, artwork: 'https://cdn.test/art/broken.jpg' }, REAL.tracks[1]!] };
    ctx.player.unmount();
    mountSkeleton();
    const engine = new FakeEngine();
    const player = mountPlayer({ engine: engine as unknown as AudioEngine, manifest, now: () => EPOCH_MS + 50_000, offline: () => false });
    ctx = { engine, player };
    $('artwork').dispatchEvent(new Event('error'));
    expect($('artwork').hidden).toBe(true);
    expect(document.querySelector('svg.ring')).not.toBeNull();
  });
});
