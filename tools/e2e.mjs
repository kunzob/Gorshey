// No-dependency browser checks: headless Chrome over the DevTools protocol (Node's built-in WebSocket), against a
// `vite preview` of dist/. Run with `npm run e2e` after `npm run build`. Not part of `npm test` or `npm run build`.
//
// Presence rule (PROGRESS.md, M9): every page gets a stubbed WebSocket, so no script ever joins the live presence
// channel. `openTab({ allowWebSocket: true })` exists for the single, deliberate CSP check in M10 only.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

export const WEBSOCKET_STUB = "window.WebSocket = function () { throw new Error('WebSocket stubbed by tools/e2e.mjs'); };";

export function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!found) throw new Error('Chrome not found; set CHROME_PATH');
  return found;
}

/** Starts headless Chrome with a throwaway profile. Returns { port, close }. */
export async function launchChrome({ port = 9340, extraArgs = [] } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'gorshey-e2e-'));
  const proc = spawn(
    findChrome(),
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--mute-audio',
      ...extraArgs,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 75; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`);
      break;
    } catch {
      await sleep(200);
    }
  }
  return {
    port,
    async close() {
      proc.kill();
      await sleep(500);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // Chrome may still hold a lock on Windows; the OS temp cleaner takes it
      }
    },
  };
}

/** Opens a tab and returns a small CDP client. WebSocket is stubbed unless allowWebSocket is set. */
export async function openTab(chrome, { allowWebSocket = false, init = '' } = {}) {
  const t = await (await fetch(`http://127.0.0.1:${chrome.port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed');
    return r.result.value;
  };
  await send('Page.enable');
  const source = `${allowWebSocket ? '' : WEBSOCKET_STUB}\n${init}`;
  await send('Page.addScriptToEvaluateOnNewDocument', { source });
  return {
    send,
    evaluate,
    on: (fn) => listeners.push(fn),
    async waitFor(expr, ms = 15000) {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        if (await evaluate(expr)) return true;
        await sleep(150);
      }
      return false;
    },
    async screenshot(path) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(shot.data, 'base64'));
    },
    async close() {
      ws.close();
      await fetch(`http://127.0.0.1:${chrome.port}/json/close/${t.id}`);
    },
  };
}

/** Starts `vite preview` on dist/ and waits for it. Returns { url, close }. */
export async function startPreview(port = 4319) {
  if (!existsSync('dist/index.html')) throw new Error('dist/ is missing: run npm run build first');
  // Vite's own bin through node: no shell, same on every platform, and proc.pid is the server itself.
  const vite = join('node_modules', 'vite', 'bin', 'vite.js');
  const proc = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      await sleep(200);
    }
  }
  return {
    url,
    async close() {
      proc.kill();
      await sleep(300);
    },
  };
}

export const localeInit = (locale) => `try { localStorage.setItem('gorshey.locale', '${locale}'); } catch {}`;

// ---- Tibetan rendering page (task file M10 step 2) ---------------------------------------------------------------
// tests/tibetan-render.html, served on the preview origin at /__e2e/tibetan-render.html through the DevTools Fetch
// domain (never shipped: it is not in public/), with the built app stylesheet linked in, so the real rules and the
// self-hosted font are under test. Chrome only; Safari/WebKit is a manual check (docs/QA-CHECKLIST.md).

export const TIBETAN_PAGE_PATH = '/__e2e/tibetan-render.html';

/** The page with the built stylesheet from dist/index.html linked in. */
export function tibetanPageHtml() {
  const css = readFileSync(join('dist', 'index.html'), 'utf8').match(/href="(\/assets\/[^"]+\.css)"/);
  if (!css) throw new Error('no stylesheet link in dist/index.html: run npm run build first');
  const page = readFileSync(join('tests', 'tibetan-render.html'), 'utf8');
  if (!page.includes('href="%APP_CSS%"')) throw new Error('tests/tibetan-render.html has no href="%APP_CSS%" link');
  return page.replace('href="%APP_CSS%"', `href="${css[1]}"`);
}

/** Counts pixels that differ between two PNG screenshots (base64), decoded in the page with a canvas. */
const PNG_DIFF = `async (a, b, mode, pad, h) => {
  const load = (s) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = 'data:image/png;base64,' + s; });
  const px = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, im.width, im.height).data; };
  const A = await load(a); const da = px(A); let n = 0;
  if (mode === 'yellow') { for (let i = 0; i < da.length; i += 4) if (da[i] > 96 && da[i + 1] > 96) n++; return n; }
  const B = await load(b); if (A.width !== B.width || A.height !== B.height) return -1; const db = px(B);
  for (let i = 0; i < da.length; i += 4) {
    // 'edges': only above the box and beside it; below it a clamped box legitimately hides its later lines.
    if (mode === 'edges' && Math.floor(i / 4 / A.width) >= pad + h) continue;
    if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 30) n++;
  }
  return n;
}`;

async function shotOf(tab, selector, pad = 0) {
  const r = await tab.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height }; })()`);
  const clip = { x: Math.floor(r.x - pad), y: Math.floor(r.y - pad), width: Math.ceil(r.width + 2 * pad), height: Math.ceil(r.height + 2 * pad), scale: 1 };
  return (await tab.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true })).data;
}

async function runTibetanChecks(chrome, preview, outDir, check) {
  const tab = await openTab(chrome);
  const html = Buffer.from(tibetanPageHtml(), 'utf8').toString('base64');
  // The app checks above registered the production service worker in this profile; it would answer this navigation
  // with the cached app shell before the Fetch interception sees it.
  await tab.send('Network.enable');
  await tab.send('Network.setBypassServiceWorker', { bypass: true });
  await tab.send('Fetch.enable', { patterns: [{ urlPattern: `*${TIBETAN_PAGE_PATH}` }] });
  tab.on((msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    void tab.send('Fetch.fulfillRequest', {
      requestId: msg.params.requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }],
      body: html,
    });
  });
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1400, deviceScaleFactor: 1, mobile: false });
    await tab.send('Page.navigate', { url: new URL(TIBETAN_PAGE_PATH, preview.url).href });
    const pageOk = await tab.waitFor(`document.title.startsWith('Gorshey: Tibetan rendering test')`);
    check('[tibetan] the test page is served (not the app shell)', pageOk);
    if (!pageOk) return;
    await tab.evaluate('document.fonts.ready.then(() => true)');
    // fonts.check() is true when no face of that name exists at all, so require a loaded face by name.
    const fontOk = await tab.evaluate(`[...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Gorshey Tibetan' && f.status === 'loaded')`);
    check('[tibetan] the self-hosted Tibetan font loads', fontOk);
    const clampOn = await tab.evaluate(`getComputedStyle(document.getElementById('title')).webkitLineClamp === '2'`);
    check("[tibetan] the app stylesheet applies (the player's .title clamp is active on the sample)", clampOn);

    // The clamped title: the same box with its overflow clip lifted (clamp kept) must look identical.
    const clamped = await shotOf(tab, '#title', 20);
    await tab.evaluate(`document.getElementById('title').style.overflow = 'visible', true`);
    const free = await shotOf(tab, '#title', 20);
    await tab.evaluate(`document.getElementById('title').style.overflow = '', true`);
    const titleH = await tab.evaluate(`Math.ceil(document.getElementById('title').getBoundingClientRect().height)`);
    const cut = await tab.evaluate(`(${PNG_DIFF})(${JSON.stringify(clamped)}, ${JSON.stringify(free)}, 'edges', 20, ${titleH})`);
    check(`[tibetan] the title's line clamp cuts no ink above or beside the box (pixels removed by the clip)`, cut === 0, String(cut));

    // Control: at the old line height (1.9) the same check must find cut ink, or it proves nothing.
    await tab.evaluate(`document.getElementById('title').style.lineHeight = '1.9', true`);
    const oldClamped = await shotOf(tab, '#title', 20);
    await tab.evaluate(`document.getElementById('title').style.overflow = 'visible', true`);
    const oldFree = await shotOf(tab, '#title', 20);
    await tab.evaluate(`Object.assign(document.getElementById('title').style, { overflow: '', lineHeight: '' }), true`);
    const oldH = await tab.evaluate(`(() => { const t = document.getElementById('title'); t.style.lineHeight = '1.9';
      const h = Math.ceil(t.getBoundingClientRect().height); t.style.lineHeight = ''; return h; })()`);
    const oldCut = await tab.evaluate(`(${PNG_DIFF})(${JSON.stringify(oldClamped)}, ${JSON.stringify(oldFree)}, 'edges', 20, ${oldH})`);
    check('[tibetan] control: at line-height 1.9 the same check does find cut ink', oldCut > 0, String(oldCut));

    // Regression guard for size-adjust / line height: the font's ink must fit the title's line box (this also covers
    // the bottom edge, which the pixel check above cannot see past the clamp's hidden lines).
    const ink = await tab.evaluate(`(() => {
      const t = document.getElementById('title'); const cs = getComputedStyle(t);
      const L = parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
      const c = document.createElement('canvas').getContext('2d'); c.font = '100px "Gorshey Tibetan"';
      const f = c.measureText('ཀ'); const A = f.fontBoundingBoxAscent / 100; const D = f.fontBoundingBoxDescent / 100;
      const half = (L - A - D) / 2; let up = -9; let down = -9;
      for (const el of [...document.querySelectorAll('.sample'), t]) { const m = c.measureText(el.textContent);
        up = Math.max(up, m.actualBoundingBoxAscent / 100 - (A + half)); down = Math.max(down, m.actualBoundingBoxDescent / 100 - (D + half)); }
      return { L: +L.toFixed(3), up: +up.toFixed(3), down: +down.toFixed(3) };
    })()`);
    check(`[tibetan] ink fits the title's line box (line-height ${ink.L})`,
      [ink.L, ink.up, ink.down].every(Number.isFinite) && ink.up <= 0 && ink.down <= 0,
      `beyond the box: ${ink.up}em above, ${ink.down}em below (<= 0 fits)`);

    // Wrapping: every line break in the narrow title falls after a tsheg, shad or space.
    const breaks = await tab.evaluate(`(() => {
      const node = document.getElementById('wrap').firstChild; const s = node.textContent; const r = document.createRange();
      const out = []; let last = null;
      for (let i = 0; i < s.length; i++) { r.setStart(node, i); r.setEnd(node, i + 1); const rects = r.getClientRects();
        if (!rects.length) continue; const top = Math.round(rects[0].top);
        if (last !== null && top > last + 4) out.push(s.codePointAt(i - 1)); last = top; }
      return out;
    })()`);
    const okBreak = (cp) => cp === 0x0f0b || cp === 0x0f0d || cp === 0x0f0e || cp === 0x0f14 || cp === 0x20;
    check('[tibetan] a narrow title wraps only after tsheg, shad or space', breaks.length > 0 && breaks.every(okBreak),
      breaks.map((cp) => 'U+' + cp.toString(16)).join(' '));

    const sizes = await tab.evaluate(`(() => { const h = (id) => document.getElementById(id).getBoundingClientRect().height;
      const mixed = document.getElementById('mixed'); const r = document.createRange(); r.selectNodeContents(mixed.firstChild);
      return { fallback: h('fallback'), webfont: h('webfont'), bo: mixed.querySelector('span').getBoundingClientRect().height, latin: r.getBoundingClientRect().height }; })()`);
    check('[tibetan] web font and fallback give the same line box (no jump on swap)', sizes.fallback === sizes.webfont,
      `${sizes.fallback} vs ${sizes.webfont}`);
    check('[tibetan] Tibetan is not smaller than Latin next to it', sizes.bo >= sizes.latin, `${sizes.bo} vs ${sizes.latin}`);

    // Adjacent lines at the title's line height never touch, at any horizontal alignment.
    let worst = { px: 0, shift: 0 };
    for (let shift = 0; shift < 40; shift += 2) {
      await tab.evaluate(`document.getElementById('collide-2').style.marginLeft = '${shift}px', true`);
      const png = await shotOf(tab, '#collide');
      const px = await tab.evaluate(`(${PNG_DIFF})(${JSON.stringify(png)}, null, 'yellow')`);
      if (px > worst.px) worst = { px, shift };
    }
    check('[tibetan] adjacent title lines never touch (deep stacks over tall vowels)', worst.px === 0,
      `worst ${worst.px} px at ${worst.shift} px shift`);

    // Control: squeezed to line-height 1.5 the same probe must see the lines touch, or it proves nothing.
    await tab.evaluate(`document.querySelectorAll('#collide .title').forEach((p) => (p.style.lineHeight = '1.5')), true`);
    const squeezed = await tab.evaluate(`(${PNG_DIFF})(${JSON.stringify(await shotOf(tab, '#collide'))}, null, 'yellow')`);
    await tab.evaluate(`document.querySelectorAll('#collide .title').forEach((p) => (p.style.lineHeight = '')), true`);
    check('[tibetan] control: at line-height 1.5 the collision probe does see touching lines', squeezed > 0, `${squeezed} px`);

    await tab.evaluate(`document.getElementById('collide-2').style.marginLeft = '', true`);
    const full = await tab.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(outDir, 'tibetan-render.png'), Buffer.from(full.data, 'base64'));
  } finally {
    await tab.close();
  }
}

// ---- the e2e checks (task file M10 step 1) ------------------------------------------------------------------------

const CLIPPABLE = ['#station', '#title', '#subtitle', '#artist', '#eyebrow', '#nextup', '#footer', '#badge', '#play', '#locale'];

async function runChecks(outDir) {
  mkdirSync(outDir, { recursive: true });
  const preview = await startPreview();
  const chrome = await launchChrome();
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };
  try {
    for (const locale of ['en', 'bo']) {
      const tab = await openTab(chrome, { init: localeInit(locale) });
      await tab.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 2, mobile: true });
      await tab.send('Page.navigate', { url: preview.url });
      const loaded = await tab.waitFor(`document.getElementById('title')?.textContent !== '—'`);
      await tab.evaluate('document.fonts.ready.then(() => true)');
      check(`[${locale}] page loads and the track manifest fills the title`, loaded);
      check(`[${locale}] <html lang> is ${locale}`, (await tab.evaluate('document.documentElement.lang')) === locale);

      const clipped = await tab.evaluate(`${JSON.stringify(CLIPPABLE)}.filter((s) => { const el = document.querySelector(s);
        return el && el.scrollHeight > el.clientHeight + 1; })`);
      check(`[${locale}] no clipped text box (scrollHeight <= clientHeight)`, clipped.length === 0, clipped.join(', '));
      const hScroll = await tab.evaluate('document.documentElement.scrollWidth > window.innerWidth');
      check(`[${locale}] no horizontal scroll at 375x667`, !hScroll);
      await tab.screenshot(join(outDir, `e2e-${locale}-375x667.png`));

      await tab.evaluate(`document.getElementById('play').click(), true`);
      const playing = await tab.waitFor(
        `document.getElementById('halo').hasAttribute('data-active') && /\\d:\\d\\d/.test(document.getElementById('position').textContent)`,
        25000,
      );
      check(`[${locale}] play starts after a click (ring active, position ticking)`, playing);
      await sleep(1500);
      const badge = await tab.evaluate(`document.getElementById('badge').textContent`);
      const dotLive = await tab.evaluate(`document.getElementById('dot').hasAttribute('data-live')`);
      check(`[${locale}] presence blocked: badge falls back to the placeholder, dot not live`, /—/.test(badge) && !dotLive, badge);
      const status = await tab.evaluate(`document.getElementById('status').textContent`);
      check(`[${locale}] playback is unaffected by presence (no error status)`, status === '', status);
      await tab.evaluate(`document.getElementById('play').click(), true`);
      const paused = await tab.waitFor(`!document.getElementById('halo').hasAttribute('data-active')`);
      check(`[${locale}] pause stops the ring`, paused);

      const before = await tab.evaluate('document.documentElement.lang');
      await tab.evaluate(`document.getElementById('locale').click(), true`);
      const after = await tab.evaluate('document.documentElement.lang');
      check(`[${locale}] locale toggle switches the language`, before !== after, `${before} -> ${after}`);
      await tab.close();
    }
    await runTibetanChecks(chrome, preview, outDir, check);
  } finally {
    await chrome.close();
    await preview.close();
  }
  writeFileSync(join(outDir, 'e2e-results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed} passed, ${failed} failed`);
  return failed === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ok = await runChecks(process.argv[2] ?? 'scratch/e2e');
  process.exit(ok ? 0 : 1);
}
