// Writes the PWA icons in public/icons/ from one original SVG, tools/icon/gorshey-mark.svg.
// Nothing on the build machine rasterises SVG (ffmpeg has no librsvg), and a new dependency is not wanted,
// so this renders the small SVG subset the mark uses: <rect>, <circle>, <polygon> with flat #rrggbb fills.
// Anything else (path, g, transform, opacity, image...) is refused, so the PNGs always match the source.
// Deterministic: 4x4 supersampling, RGB PNG (no alpha), zlib level 9. Run: node tools/make-icons.mjs
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SS = 4; // subsamples per axis
const SAFE_SCALE = 0.8; // maskable: the mark fits inside the 80% safe zone
const MAX_BYTES = 50 * 1024;

const ALLOWED = {
  svg: ['xmlns', 'viewBox'],
  title: [],
  rect: ['id', 'x', 'y', 'width', 'height', 'fill'],
  circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width'],
  polygon: ['points', 'fill'],
};

function attrs(tag, raw) {
  const out = {};
  for (const m of raw.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    if (!ALLOWED[tag].includes(m[1])) throw new Error(`unsupported attribute "${m[1]}" on <${tag}>`);
    out[m[1]] = m[2];
  }
  return out;
}

function color(v, where) {
  if (v === 'none') return null;
  if (!/^#[0-9a-f]{6}$/i.test(v ?? '')) throw new Error(`unsupported colour "${v}" on <${where}>`);
  return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
}

function num(v) {
  const n = Number(v);
  if (v === undefined || v === '' || !Number.isFinite(n)) throw new Error(`unsupported number "${v}"`);
  return n;
}

/** Parses the supported subset. Throws "unsupported ..." on anything else. */
export function parseSvg(source) {
  const text = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<title>[\s\S]*?<\/title>/g, '');
  const shapes = [];
  let viewBox = null;
  for (const m of text.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g)) {
    const [, closing, tag, rest] = m;
    if (!Object.hasOwn(ALLOWED, tag)) throw new Error(`unsupported element <${tag}>`);
    if (closing) continue;
    const a = attrs(tag, rest);
    if (tag === 'svg') {
      viewBox = (a.viewBox ?? '').split(/\s+/).map(num);
      if (viewBox.length !== 4 || viewBox[0] !== 0 || viewBox[1] !== 0 || viewBox[2] !== viewBox[3]) {
        throw new Error('unsupported viewBox: must be "0 0 S S"');
      }
    } else if (tag === 'rect') {
      shapes.push({
        kind: 'rect',
        x: num(a.x),
        y: num(a.y),
        width: num(a.width),
        height: num(a.height),
        fill: color(a.fill, tag),
        background: a.id === 'background',
      });
    } else if (tag === 'circle') {
      shapes.push({
        kind: 'circle',
        cx: num(a.cx),
        cy: num(a.cy),
        r: num(a.r),
        fill: color(a.fill ?? 'none', tag),
        stroke: color(a.stroke ?? 'none', tag),
        strokeWidth: num(a['stroke-width'] ?? '0'),
      });
    } else if (tag === 'polygon') {
      const n = (a.points ?? '').trim().split(/[\s,]+/).map(num);
      if (n.length < 6 || n.length % 2) throw new Error('unsupported polygon points');
      const points = [];
      for (let i = 0; i < n.length; i += 2) points.push([n[i], n[i + 1]]);
      shapes.push({ kind: 'polygon', points, fill: color(a.fill, tag) });
    }
  }
  if (!viewBox) throw new Error('unsupported document: no <svg> root');
  shapes.viewBoxSize = viewBox[2];
  return shapes;
}

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Colour of the topmost shape at (x, y) in viewBox units, or null. */
function colourAt(shapes, x, y, safeZone, half) {
  for (let k = shapes.length - 1; k >= 0; k--) {
    const s = shapes[k];
    let px = x;
    let py = y;
    if (safeZone && !s.background) {
      px = half + (x - half) / SAFE_SCALE;
      py = half + (y - half) / SAFE_SCALE;
    }
    if (s.kind === 'rect') {
      if (px >= s.x && px < s.x + s.width && py >= s.y && py < s.y + s.height) return s.fill;
    } else if (s.kind === 'circle') {
      const d = Math.hypot(px - s.cx, py - s.cy);
      if (s.stroke && Math.abs(d - s.r) <= s.strokeWidth / 2) return s.stroke;
      if (s.fill && d <= s.r) return s.fill;
    } else if (inPolygon(px, py, s.points)) {
      return s.fill;
    }
  }
  return null;
}

/** RGB bytes (size × size × 3). safeZone scales every non-background shape to 80% about the centre. */
export function rasterize(shapes, size, { safeZone }) {
  const vb = shapes.viewBoxSize ?? 512;
  const half = vb / 2;
  const out = new Uint8Array(size * size * 3);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const vx = ((x + (sx + 0.5) / SS) * vb) / size;
          const vy = ((y + (sy + 0.5) / SS) * vb) / size;
          const c = colourAt(shapes, vx, vy, safeZone, half) ?? [0, 0, 0];
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const i = (y * size + x) * 3;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
    }
  }
  return out;
}

const crcTable = Array.from({ length: 256 }, (_, k) => {
  let c = k;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** RGB (colour type 2, 8-bit) PNG: no alpha channel, so no transparency. */
export function encodePng(rgb, size) {
  const stride = 1 + size * 3;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    raw.set(rgb.subarray(y * size * 3, (y + 1) * size * 3), y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const OUTPUTS = [
  { file: 'icon-192.png', size: 192, safeZone: false },
  { file: 'icon-512.png', size: 512, safeZone: false },
  { file: 'icon-maskable-512.png', size: 512, safeZone: true },
  { file: 'apple-touch-icon-180.png', size: 180, safeZone: false },
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const shapes = parseSvg(readFileSync(new URL('./icon/gorshey-mark.svg', import.meta.url), 'utf8'));
  const outDir = fileURLToPath(new URL('../public/icons/', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  let failed = false;
  for (const o of OUTPUTS) {
    const path = outDir + o.file;
    writeFileSync(path, encodePng(rasterize(shapes, o.size, o), o.size));
    const bytes = statSync(path).size;
    console.log(`${o.file} ${bytes} bytes`);
    if (bytes >= MAX_BYTES) {
      console.error(`${o.file} is over the ${MAX_BYTES}-byte budget`);
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}
