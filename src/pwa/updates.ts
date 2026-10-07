// Service-worker registration and the update handshake. No DOM: the container and callbacks are injected,
// and src/ui shows the prompt and performs the reload.
import { SKIP_WAITING } from '../core/swRoute';

export interface Updates {
  /** Activates the waiting version (user clicked the prompt). The page reloads on controllerchange. */
  apply(): void;
  /** Asks the browser to look for a new version (e.g. when the page becomes visible). */
  check(): void;
  dispose(): void;
}

const NOOP: Updates = { apply() {}, check() {}, dispose() {} };

export function initUpdates(opts: {
  container: ServiceWorkerContainer | undefined;
  /** import.meta.env.PROD: no service worker in dev, where it would hide changes. */
  prod: boolean;
  onAvailable: () => void;
  onReload: () => void;
  swUrl?: string;
}): Updates {
  const { container } = opts;
  if (!container) return NOOP;
  if (!opts.prod) {
    // Dev guard: drop any registration left on this origin by an earlier production build.
    container
      .getRegistrations()
      .then((regs) => regs.forEach((r) => void r.unregister()))
      .catch(() => {});
    return NOOP;
  }

  let reg: ServiceWorkerRegistration | undefined;
  let announced = false;
  let applying = false;
  let reloaded = false;

  const announce = (): void => {
    if (announced) return;
    announced = true;
    opts.onAvailable();
  };
  // A first install (no controller yet) is not an update, so it never prompts.
  const watch = (r: ServiceWorkerRegistration): void => {
    if (r.waiting && container.controller) announce();
    r.addEventListener('updatefound', () => {
      const worker = r.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && container.controller) announce();
      });
    });
  };
  const onControllerChange = (): void => {
    if (!applying || reloaded) return;
    reloaded = true;
    opts.onReload();
  };

  container.addEventListener('controllerchange', onControllerChange);
  container
    .register(opts.swUrl ?? '/sw.js', { scope: '/' })
    .then((r) => {
      reg = r;
      watch(r);
    })
    .catch(() => {}); // no service worker: the app still works online

  return {
    apply(): void {
      const waiting = reg?.waiting;
      if (!waiting) return;
      applying = true;
      waiting.postMessage(SKIP_WAITING);
    },
    check(): void {
      reg?.update().catch(() => {});
    },
    dispose(): void {
      container.removeEventListener('controllerchange', onControllerChange);
    },
  };
}
