import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Manifest } from '../src/core/types';
import {
  NEXT_UP_TRACK_KEY,
  VIEW_KEYS,
  nextUpRuns,
  playLabelKey,
  positionLabel,
  ringDashOffset,
  ringFraction,
  statusKey,
} from '../src/ui/view';

// Catalog strings are read from disk; a missing key fails the key tests below.
const readJson = (p: string): Record<string, string> => {
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
};
const EN = readJson('src/i18n/catalogs/en.json');
const BO = readJson('src/i18n/catalogs/bo.json');
// A missing stylesheet reads as empty, so each CSS test fails on its own assertion.
const css = (p: string): string => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};
const ALL_CSS = ['src/styles/tokens.css', 'src/styles/fonts.css', 'src/styles/base.css', 'src/styles/components.css']
  .map(css)
  .join('\n');

// Real manifest durations (mirror public/manifest.json, M1); hardcoded on purpose.
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

// ---- catalog keys used by the shell -------------------------------------------------------------

describe('shell strings come from the catalogs', () => {
  it('every key the view uses exists in both bo and en', () => {
    for (const key of VIEW_KEYS) {
      expect(EN[key], `en ${key}`).toBeTypeOf('string');
      expect(BO[key], `bo ${key}`).toBeTypeOf('string');
    }
  });

  it('the eyebrow is a template over player.live and a place-name key, not hard-coded text', () => {
    expect(EN['eyebrow.line']).toBe('{live} · {place}');
    expect(EN['player.live']).toBe('ON AIR');
    expect(EN['place.marpoRi']).toBe('MARPO RI');
  });

  it('no visible text in the shell source is hard-coded in the view module', () => {
    const src = css('src/ui/view.ts');
    // Latin words and quoted UI copy must come from a catalog key, not from the source file.
    expect(src).not.toMatch(/'(Play|Pause|Next up|Buffering|Live|ON AIR|MARPO RI)/);
  });
});

// ---- view logic ----------------------------------------------------------------------------------

describe('play button and status line', () => {
  it('the button label is "pause" while active, "play" otherwise', () => {
    expect(playLabelKey('loading')).toBe('player.pause');
    expect(playLabelKey('playing')).toBe('player.pause');
    expect(playLabelKey('buffering')).toBe('player.pause');
    expect(playLabelKey('paused')).toBe('player.play');
    expect(playLabelKey('idle')).toBe('player.play');
    expect(playLabelKey('error')).toBe('player.play');
  });

  it('the status line shows buffering, error or offline, with offline taking precedence', () => {
    expect(statusKey('buffering', false)).toBe('player.buffering');
    expect(statusKey('error', false)).toBe('player.error');
    expect(statusKey('playing', false)).toBeNull();
    expect(statusKey('error', true)).toBe('player.offline');
    expect(statusKey('buffering', true)).toBe('player.offline');
  });
});

describe('kora ring', () => {
  it('fraction is position over duration, clamped to [0, 1]', () => {
    expect(ringFraction(0, 211)).toBe(0);
    expect(ringFraction(105.5, 211)).toBeCloseTo(0.5, 6);
    expect(ringFraction(300, 211)).toBe(1);
    expect(ringFraction(-5, 211)).toBe(0);
  });

  it('zero or missing duration gives 0, never NaN', () => {
    expect(ringFraction(10, 0)).toBe(0);
  });

  it('dash offset is circumference × (1 − fraction): full at 0, zero at 1', () => {
    expect(ringDashOffset(100, 0)).toBe(100);
    expect(ringDashOffset(100, 1)).toBe(0);
    expect(ringDashOffset(100, 0.25)).toBeCloseTo(75, 6);
  });
});

describe('position label', () => {
  it('shows position over duration with Western digits while active', () => {
    expect(positionLabel(72.4, 211.255167, true)).toBe('1:12 / 3:31');
  });

  it('shows nothing when paused or idle (no placeholder text under the artist)', () => {
    expect(positionLabel(72.4, 211.255167, false)).toBe('');
  });
});

describe('next-up line', () => {
  it('uses the key that the view exports', () => {
    expect(NEXT_UP_TRACK_KEY).toBe('player.nextUp');
  });

  it('mid-track: the next title is the following track, verbatim, with lang runs', () => {
    const runs = nextUpRuns(REAL, EPOCH_MS + 50_000, 'en');
    expect(runs[0]).toEqual({ text: 'རྟེན་འབྲེལ་དགའ་བསྲུ།', lang: 'bo' });
  });

  it('last-to-first wraparound: during track 2 the next-up is track 1 (not index 2)', () => {
    const runs = nextUpRuns(REAL, EPOCH_MS + 300_000, 'en');
    expect(runs[0]).toEqual({ text: 'མ་ནི་ཡིག་དྲུག', lang: 'bo' });
  });

  it('is computed from resolve at the end of the current track plus 1 ms', () => {
    // 1 ms before the boundary the next track is track 1; 1 ms after, it is track 0 (wrapped).
    const before = nextUpRuns(REAL, EPOCH_MS + 211_254, 'en');
    const after = nextUpRuns(REAL, EPOCH_MS + 211_256, 'en');
    expect(before[0]?.text).toBe('རྟེན་འབྲེལ་དགའ་བསྲུ།'); // still in track 0: next is track 1
    expect(after[0]?.text).toBe('མ་ནི་ཡིག་དྲུག'); // now in track 1: next is track 0
  });
});

// ---- CSS ----------------------------------------------------------------------------------------

describe('Potala-night tokens and functional styling', () => {
  it('defines the night base, whitewash text, maroon-grey and gold tokens as custom properties', () => {
    const tokens = css('src/styles/tokens.css');
    expect(tokens).toMatch(/--color-night:\s*#0d0f14/i);
    expect(tokens).toMatch(/--color-whitewash:\s*#/i);
    expect(tokens).toMatch(/--color-maroon:\s*#/i);
    expect(tokens).toMatch(/--color-gold:\s*#/i);
  });

  it('touch targets are at least 48 px with at least 8 px between them', () => {
    expect(ALL_CSS).toMatch(/\.touch\s*\{[^}]*min-height:\s*48px/);
    expect(ALL_CSS).toMatch(/\.touch\s*\{[^}]*min-width:\s*48px/);
    expect(ALL_CSS).toMatch(/\.controls\s*\{[^}]*gap:\s*8px/);
  });

  it('respects prefers-reduced-motion by turning off transitions and animations', () => {
    expect(ALL_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*transition:\s*none/);
    expect(ALL_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*animation:\s*none/);
  });
});

describe(':lang(bo) rules and the Tibetan font', () => {
  it('the :lang(bo) block sets line-height ≥ 1.9, letter-spacing normal, and font-synthesis none', () => {
    const block = ALL_CSS.match(/:lang\(bo\)\s*\{([^}]*)\}/);
    expect(block, ':lang(bo) block').not.toBeNull();
    const body = block![1]!;
    expect(Number(body.match(/line-height:\s*([\d.]+)/)![1])).toBeGreaterThanOrEqual(1.9);
    expect(body).toMatch(/letter-spacing:\s*normal/);
    expect(body).toMatch(/font-synthesis:\s*none/);
  });

  it('the Tibetan @font-face is the self-hosted WOFF2, scoped to U+0F00-0FFF, with font-display swap', () => {
    const face = css('src/styles/fonts.css').match(/@font-face\s*\{[^}]*\}/);
    expect(face).not.toBeNull();
    const body = face![0];
    expect(body).toContain("url('/fonts/NotoSerifTibetan-tibetan-subset.woff2')");
    expect(body).toMatch(/unicode-range:\s*U\+0F00-0FFF/);
    expect(body).toMatch(/font-display:\s*swap/);
  });

  it('the old M4 tibetan.css is merged away', () => {
    expect(existsSync('src/styles/tibetan.css')).toBe(false);
  });
});

// ---- the font file itself -------------------------------------------------------------------------

const FONT = 'public/fonts/NotoSerifTibetan-tibetan-subset.woff2';

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// Reads a WOFF2 cmap (format 4 and 12) and returns the covered code points. Only the code points are needed.
function woff2Cmap(path: string): Set<number> {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file');
  const KNOWN = [
    'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ',
    'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS',
    'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc',
    'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
    'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
  ];
  let off = 48;
  const numTables = b.readUInt16BE(12);
  const readBase128 = () => {
    let v = 0;
    let byte: number;
    do {
      byte = b[off++]!;
      v = v * 128 + (byte & 0x7f);
    } while (byte & 0x80);
    return v;
  };
  const tables: Array<{ tag: string; txLen: number }> = [];
  for (let i = 0; i < numTables; i++) {
    const flags = b[off++]!;
    let tag: string;
    if ((flags & 0x3f) === 63) {
      tag = b.toString('ascii', off, off + 4);
      off += 4;
    } else tag = KNOWN[flags & 0x3f]!;
    const version = flags >> 6;
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : tag === 'hmtx' ? version === 1 : version !== 0;
    const origLen = readBase128();
    const txLen = transformed ? readBase128() : origLen;
    tables.push({ tag, txLen });
  }
  const raw = brotliDecompressSync(b.subarray(off));
  let pos = 0;
  const cmapTable = tables.find((t) => t.tag === 'cmap')!;
  for (const t of tables) {
    if (t.tag === 'cmap') break;
    pos += t.txLen;
  }
  const cmap = raw.subarray(pos, pos + cmapTable.txLen);
  const cps = new Set<number>();
  const n = cmap.readUInt16BE(2);
  for (let i = 0; i < n; i++) {
    const o = cmap.readUInt32BE(8 + i * 8);
    const format = cmap.readUInt16BE(o);
    if (format === 4) {
      const segCount = cmap.readUInt16BE(o + 6) / 2;
      const ends = o + 14;
      const starts = ends + segCount * 2 + 2;
      for (let s = 0; s < segCount; s++) {
        const end = cmap.readUInt16BE(ends + s * 2);
        const start = cmap.readUInt16BE(starts + s * 2);
        for (let c = start; c <= end && c < 0xffff; c++) cps.add(c);
      }
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(o + 12);
      for (let g = 0; g < groups; g++) {
        const sc = cmap.readUInt32BE(o + 16 + g * 12);
        const ec = cmap.readUInt32BE(o + 20 + g * 12);
        for (let c = sc; c <= ec; c++) cps.add(c);
      }
    }
  }
  return cps;
}

// Unassigned code points in the Tibetan block (same list as the skill's check-tibetan.mjs).
const UNASSIGNED = (cp: number) =>
  cp === 0x0f48 || (cp >= 0x0f6d && cp <= 0x0f70) || cp === 0x0f98 || cp === 0x0fbd ||
  cp === 0x0fcd || (cp >= 0x0fdb && cp <= 0x0fff);

describe('self-hosted Tibetan font', () => {
  it('the WOFF2 file matches the SHA-256 recorded in public/fonts/SOURCE.md', () => {
    const source = readFileSync('public/fonts/SOURCE.md', 'utf8');
    const recorded = source.match(/woff2 sha256:\s*([0-9a-f]{64})/)![1];
    expect(sha256(FONT)).toBe(recorded);
  });

  it('the OFL licence file is present and matches its recorded SHA-256', () => {
    const source = readFileSync('public/fonts/SOURCE.md', 'utf8');
    const recorded = source.match(/OFL\.txt sha256:\s*([0-9a-f]{64})/)![1];
    expect(sha256('public/fonts/OFL.txt')).toBe(recorded);
    expect(readFileSync('public/fonts/OFL.txt', 'utf8')).toContain('SIL OPEN FONT LICENSE');
  });

  it('covers every assigned code point in U+0F00-U+0FFF, with no glyph subsetting inside the range', () => {
    const cps = woff2Cmap(FONT);
    const missing: string[] = [];
    for (let cp = 0x0f00; cp <= 0x0fff; cp++) {
      if (!UNASSIGNED(cp) && !cps.has(cp)) missing.push(cp.toString(16).toUpperCase());
    }
    expect(missing).toEqual([]);
  });

  it('is served on every load: the page preloads it', () => {
    expect(readFileSync('index.html', 'utf8')).toMatch(
      /<link rel="preload" href="\/fonts\/NotoSerifTibetan-tibetan-subset\.woff2" as="font" type="font\/woff2" crossorigin>/,
    );
  });
});

// ---- HTML and DOM rules -----------------------------------------------------------------------------

describe('index.html skeleton', () => {
  const html = readFileSync('index.html', 'utf8');

  it('the status line is a polite live region', () => {
    expect(html).toMatch(/<p[^>]*id="status"[^>]*aria-live="polite"/);
  });

  it('the kora ring is hidden from assistive tech', () => {
    expect(html).toMatch(/<svg[^>]*class="ring"[^>]*aria-hidden="true"/);
  });

  it('a reserved, hidden slot is left for the later "update available" prompt', () => {
    expect(html).toMatch(/id="update"[^>]*hidden/);
  });

  it('shows neutral placeholders only, with no track or count', () => {
    expect(html).not.toMatch(/Song of Mani|Auspicious Welcome/);
    expect(html).toMatch(/theme-color/);
  });
});

describe('DOM writes stay in src/ui and use textContent', () => {
  function listFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? listFiles(p) : [p];
    });
  }

  it('no file under src/ui uses innerHTML, outerHTML or insertAdjacentHTML', () => {
    const offenders = listFiles('src/ui')
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /innerHTML|outerHTML|insertAdjacentHTML/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the devHarness is removed', () => {
    expect(existsSync('src/ui/devHarness.ts')).toBe(false);
  });
});

describe('one writer for <html lang>', () => {
  function listFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? listFiles(p) : [p];
    });
  }

  it('only src/ui/locale.ts assigns document.documentElement.lang (the applier)', () => {
    const writers = listFiles('src')
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /documentElement\.lang\s*=/.test(readFileSync(f, 'utf8')))
      .map((f) => f.split(sep).join('/'));
    expect(writers).toEqual(['src/ui/locale.ts']);
  });
});

describe('phone layout and Tibetan typography (visual-bug fixes)', () => {
  it('the play button is centred: the controls row centres its children', () => {
    expect(css('src/styles/components.css')).toMatch(/\.controls\s*\{[^}]*justify-content:\s*center/);
  });

  it('in Tibetan mode the Latin sans stack comes first and no bare serif precedes the Tibetan font', () => {
    const block = css('src/styles/base.css').match(/:lang\(bo\)\s*\{[^}]*font-family:\s*([^;]+);/);
    expect(block, ':lang(bo) font-family').not.toBeNull();
    const families = block![1]!.split(',').map((f) => f.trim().replace(/"/g, ''));
    expect(['system-ui', 'ui-sans-serif', 'sans-serif']).toContain(families[0]);
    const tibetan = families.indexOf('Gorshey Tibetan');
    const bareSerif = families.indexOf('serif');
    expect(tibetan).toBeGreaterThan(0);
    expect(bareSerif === -1 || bareSerif > tibetan).toBe(true);
  });

  it('one Tibetan scale: both Tibetan @font-face rules use size-adjust 125%', () => {
    const faces = css('src/styles/fonts.css').match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces).toHaveLength(2);
    for (const face of faces) expect(face).toMatch(/size-adjust:\s*125%/);
  });

  it('Tibetan is scaled through size-adjust, not a per-element font-size', () => {
    const block = css('src/styles/base.css').match(/:lang\(bo\)\s*\{([^}]*)\}/)![1]!;
    expect(block).not.toMatch(/font-size/);
  });

  it('the player fits one viewport: 100dvh, with the ring sized from height as well as width', () => {
    expect(css('src/styles/components.css')).toMatch(/\.player\s*\{[^}]*min-height:\s*100dvh/);
    expect(css('src/styles/tokens.css')).toMatch(/--ring-size:[^;]*dvh/);
  });
});
