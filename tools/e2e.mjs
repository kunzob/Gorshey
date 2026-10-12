// No-dependency browser checks: headless Chrome over the DevTools protocol (Node's built-in WebSocket), against a
// `vite preview` of dist/. Run with `npm run e2e` after `npm run build`. Not part of `npm test` or `npm run build`.
//
// Presence rule (PROGRESS.md, M9): every page gets a stubbed WebSocket, so no script ever joins the live presence
// channel. `openTab({ allowWebSocket: true })` exists for the single, deliberate CSP check in M10 only.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
