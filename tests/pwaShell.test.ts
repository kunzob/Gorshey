import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REQUIRED_ENTRIES, findForbidden, findMissing, readPrecacheEntries } from '../tools/check-precache.mjs';
import { encodePng, parseSvg, rasterize } from '../tools/make-icons.mjs';

const read = (p: string): string => readFileSync(p, 'utf8');

/** Width, height and colour type from a PNG's IHDR chunk. */
function pngInfo(path: string): { width: number; height: number; colorType: number } {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25]! };
}

const ICON_SOURCE = 'tools/icon/gorshey-mark.svg';
const ICONS = [
  { file: 'public/icons/icon-192.png', size: 192 },
  { file: 'public/icons/icon-512.png', size: 512 },
  { file: 'public/icons/icon-maskable-512.png', size: 512 },
  { file: 'public/icons/apple-touch-icon-180.png', size: 180 },
];

describe('web app manifest (public/manifest.webmanifest, not the track manifest)', () => {
  const wm = JSON.parse(read('public/manifest.webmanifest')) as Record<string, unknown>;

  it('has the install fields', () => {
    expect(wm.name).toBe('Gorshey · སྒོར་གཞས།');
    expect(wm.short_name).toBe('Gorshey');
    expect(wm.display).toBe('standalone');
    expect(wm.start_url).toBe('/');
    expect(wm.scope).toBe('/');
    expect(wm.background_color).toBe('#0d0f14');
    expect(wm.theme_color).toBe('#0d0f14');
  });

  it('lists 192, 512 and maskable 512 icons that exist', () => {
    const icons = wm.icons as Array<{ src: string; sizes: string; type: string; purpose?: string }>;
    expect(icons).toEqual([
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
    for (const i of icons) expect(existsSync(`public${i.src}`)).toBe(true);
  });

  it('the track manifest is still the playlist (has tracks and an epoch)', () => {
    const track = JSON.parse(read('public/manifest.json')) as Record<string, unknown>;
    expect(Array.isArray(track.tracks)).toBe(true);
    expect(typeof track.epoch).toBe('string');
  });
});

describe('icons', () => {
  it.each(ICONS)('$file is a $size px opaque PNG under 50 KB', ({ file, size }) => {
    const info = pngInfo(file);
    expect(info.width).toBe(size);
    expect(info.height).toBe(size);
    expect(info.colorType).toBe(2); // RGB, no alpha channel: no transparency (needed for apple-touch)
    expect(statSync(file).size).toBeLessThan(50 * 1024);
  });

  it('the committed 192 icon is exactly what the script renders from the SVG source', () => {
    const shapes = parseSvg(read(ICON_SOURCE));
    const fresh = encodePng(rasterize(shapes, 192, { safeZone: false }), 192);
    expect(Buffer.compare(fresh, readFileSync('public/icons/icon-192.png'))).toBe(0);
  });

  it('the source SVG is original: only rect, circle and polygon, no image, href or path', () => {
    const svg = read(ICON_SOURCE);
    expect(svg).not.toMatch(/<image|href=|<path|<text|base64/);
    expect(() => parseSvg(svg)).not.toThrow();
  });

  it.each([
    '<path d="M0 0"/>',
    '<g><rect x="0" y="0" width="1" height="1" fill="#000"/></g>',
    '<text>x</text>',
    '<image href="a.png"/>',
    '<ellipse cx="1" cy="1" rx="1" ry="1"/>',
  ])('the rasteriser refuses unsupported markup: %s', (inner) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${inner}</svg>`;
    expect(() => parseSvg(svg)).toThrow(/unsupported/i);
  });

  it('the rasteriser refuses unsupported attributes (transform, opacity)', () => {
    const base = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">';
    expect(() => parseSvg(`${base}<rect x="0" y="0" width="1" height="1" fill="#000" transform="rotate(3)"/></svg>`)).toThrow(/unsupported/i);
    expect(() => parseSvg(`${base}<circle cx="1" cy="1" r="1" fill="#000" opacity="0.5"/></svg>`)).toThrow(/unsupported/i);
  });

  it('the maskable icon keeps the mark inside the 80% safe zone: the outer ring of pixels is pure background', () => {
    const shapes = parseSvg(read(ICON_SOURCE));
    const rgb = rasterize(shapes, 64, { safeZone: true });
    const bg = [0x0d, 0x0f, 0x14];
    // Anything outside the circle of radius 0.4 × size must be background.
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const d = Math.hypot(x + 0.5 - 32, y + 0.5 - 32);
        if (d <= 0.4 * 64 + 1) continue;
        const i = (y * 64 + x) * 3;
        expect([rgb[i], rgb[i + 1], rgb[i + 2]]).toEqual(bg);
      }
    }
  });
});

describe('index.html PWA wiring', () => {
  const html = read('index.html');
  it('links the web app manifest and the apple-touch icon', () => {
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon-180\.png"/);
    expect(html).not.toMatch(/href="\/manifest\.json"/);
  });

  it('has the iOS standalone meta tags', () => {
    expect(html).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes"/);
    expect(html).toMatch(/<meta name="mobile-web-app-capable" content="yes"/);
    expect(html).toMatch(/<meta name="apple-mobile-web-app-title" content="Gorshey"/);
  });

  it('the update prompt is a hidden button', () => {
    expect(html).toMatch(/<button id="update" class="update[^"]*" type="button"[^>]*hidden/);
  });
});

describe('build configuration', () => {
  const vite = read('vite.config.ts');
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

  it('vite-plugin-pwa: injectManifest from src/sw.ts, no auto-register, no generated manifest, off in dev', () => {
    expect(vite).toMatch(/strategies: 'injectManifest'/);
    expect(vite).toMatch(/srcDir: 'src'/);
    expect(vite).toMatch(/filename: 'sw\.ts'/);
    expect(vite).toMatch(/injectRegister: false/);
    expect(vite).toMatch(/manifest: false/);
    expect(vite).toMatch(/devOptions: \{ enabled: false \}/);
  });

  it('the precache glob ignores the track manifest, artwork and markdown', () => {
    expect(vite).toMatch(/globIgnores: \[[^\]]*'manifest\.json'/);
    expect(vite).toMatch(/globIgnores: \[[^\]]*'artwork\/\*\*'/);
    expect(vite).toMatch(/globIgnores: \[[^\]]*'\*\*\/\*\.md'/);
    expect(vite).not.toMatch(/globPatterns: \[[^\]]*json[,}]/);
  });

  it('lint type-checks the service worker; build runs the precache check', () => {
    expect(pkg.scripts.lint).toContain('tsc -p tsconfig.sw.json --noEmit');
    expect(pkg.scripts.build).toContain('node tools/check-precache.mjs dist');
  });

  it('the service worker has its own tsconfig (WebWorker lib); the main one excludes it', () => {
    const main = JSON.parse(read('tsconfig.json')) as { exclude?: string[] };
    const sw = JSON.parse(read('tsconfig.sw.json')) as { compilerOptions: { lib: string[] }; include: string[] };
    expect(main.exclude).toContain('src/sw.ts');
    expect(sw.compilerOptions.lib).toContain('WebWorker');
    expect(sw.include).toContain('src/sw.ts');
  });

  it('main.ts registers the service worker only in production builds', () => {
    expect(read('src/main.ts')).toMatch(/prod: import\.meta\.env\.PROD/);
  });
});

describe('precache check (tools/check-precache.mjs)', () => {
  it('reads entries injected by workbox into sw.js', () => {
    const sw = 'x([{"revision":"a1","url":"index.html"},{"revision":null,"url":"assets/index-abc.js"}]);';
    expect(readPrecacheEntries(sw)).toEqual(['index.html', 'assets/index-abc.js']);
  });

  it('flags the track manifest, artwork, audio and markdown; allows the web app manifest and shell', () => {
    const entries = [
      'index.html',
      'manifest.webmanifest',
      'manifest.json',
      'artwork/artwork-512.jpg',
      'audio/a.mp3',
      'x.M4A',
      'ASSETS.md',
      'assets/index-abc.js',
    ];
    expect(findForbidden(entries)).toEqual(['manifest.json', 'artwork/artwork-512.jpg', 'audio/a.mp3', 'x.M4A', 'ASSETS.md']);
  });

  it('requires the shell, the Tibetan font, its licence and the web app manifest', () => {
    expect(REQUIRED_ENTRIES).toEqual(
      expect.arrayContaining(['index.html', 'fonts/NotoSerifTibetan-tibetan-subset.woff2', 'fonts/OFL.txt', 'manifest.webmanifest']),
    );
    expect(findMissing(['index.html'])).toContain('fonts/OFL.txt');
    expect(findMissing(REQUIRED_ENTRIES)).toEqual([]);
  });
});
