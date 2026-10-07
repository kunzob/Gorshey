import { describe, expect, it, vi } from 'vitest';
import { initUpdates } from '../src/pwa/updates';

class FakeWorker extends EventTarget {
  state = 'installing';
  postMessage = vi.fn();
  setState(s: string): void {
    this.state = s;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  update = vi.fn(async () => {});
  unregister = vi.fn(async () => true);
  startInstall(): FakeWorker {
    const w = new FakeWorker();
    this.installing = w;
    this.dispatchEvent(new Event('updatefound'));
    return w;
  }
}

class FakeContainer extends EventTarget {
  controller: object | null = {};
  reg = new FakeRegistration();
  register = vi.fn(async () => this.reg);
  existing: FakeRegistration[] = [];
  getRegistrations = vi.fn(async () => this.existing);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(c = new FakeContainer(), prod = true) {
  const onAvailable = vi.fn();
  const onReload = vi.fn();
  const updates = initUpdates({ container: c as unknown as ServiceWorkerContainer, prod, onAvailable, onReload });
  return { c, updates, onAvailable, onReload };
}

describe('updates: registration', () => {
  it('registers /sw.js at scope / in production', async () => {
    const { c } = setup();
    await flush();
    expect(c.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('dev: never registers, and unregisters any leftover registration', async () => {
    const c = new FakeContainer();
    const leftover = new FakeRegistration();
    c.existing = [leftover];
    setup(c, false);
    await flush();
    expect(c.register).not.toHaveBeenCalled();
    expect(leftover.unregister).toHaveBeenCalled();
  });

  it('no navigator.serviceWorker: throws nothing, and the handle is safe', () => {
    const onAvailable = vi.fn();
    const u = initUpdates({ container: undefined, prod: true, onAvailable, onReload: vi.fn() });
    expect(() => {
      u.apply();
      u.check();
      u.dispose();
    }).not.toThrow();
    expect(onAvailable).not.toHaveBeenCalled();
  });

  it('a rejected registration throws nothing and announces nothing', async () => {
    const c = new FakeContainer();
    c.register.mockRejectedValueOnce(new Error('SecurityError'));
    const { onAvailable, updates } = setup(c);
    await flush();
    expect(onAvailable).not.toHaveBeenCalled();
    expect(() => updates.check()).not.toThrow();
  });
});

describe('updates: announcing a waiting worker', () => {
  it('a waiting worker at registration (page already controlled) announces once', async () => {
    const c = new FakeContainer();
    c.reg.waiting = new FakeWorker();
    const { onAvailable } = setup(c);
    await flush();
    expect(onAvailable).toHaveBeenCalledTimes(1);
  });

  it('a new worker reaching installed while controlled announces', async () => {
    const { c, onAvailable } = setup();
    await flush();
    const w = c.reg.startInstall();
    expect(onAvailable).not.toHaveBeenCalled();
    c.reg.waiting = w;
    w.setState('installed');
    expect(onAvailable).toHaveBeenCalledTimes(1);
  });

  it('first install (no controller) does not announce', async () => {
    const c = new FakeContainer();
    c.controller = null;
    const { onAvailable } = setup(c);
    await flush();
    const w = c.reg.startInstall();
    w.setState('installed');
    expect(onAvailable).not.toHaveBeenCalled();
  });

  it('other worker states do not announce', async () => {
    const { c, onAvailable } = setup();
    await flush();
    const w = c.reg.startInstall();
    w.setState('redundant');
    w.setState('activating');
    expect(onAvailable).not.toHaveBeenCalled();
  });

  it('updatefound with no installing worker is ignored', async () => {
    const { c, onAvailable } = setup();
    await flush();
    c.reg.dispatchEvent(new Event('updatefound'));
    expect(onAvailable).not.toHaveBeenCalled();
  });

  it('announces at most once', async () => {
    const c = new FakeContainer();
    c.reg.waiting = new FakeWorker();
    const { onAvailable } = setup(c);
    await flush();
    c.reg.startInstall().setState('installed');
    expect(onAvailable).toHaveBeenCalledTimes(1);
  });
});

describe('updates: applying', () => {
  it('apply() posts SKIP_WAITING to the waiting worker', async () => {
    const c = new FakeContainer();
    const waiting = new FakeWorker();
    c.reg.waiting = waiting;
    const { updates } = setup(c);
    await flush();
    updates.apply();
    expect(waiting.postMessage).toHaveBeenCalledWith('SKIP_WAITING');
  });

  it('apply() with no waiting worker does nothing, and a later controllerchange does not reload', async () => {
    const { c, updates, onReload } = setup();
    await flush();
    updates.apply();
    c.dispatchEvent(new Event('controllerchange'));
    expect(onReload).not.toHaveBeenCalled();
  });

  it('controllerchange reloads once, only after apply()', async () => {
    const c = new FakeContainer();
    c.reg.waiting = new FakeWorker();
    const { updates, onReload } = setup(c);
    await flush();
    c.dispatchEvent(new Event('controllerchange'));
    expect(onReload).not.toHaveBeenCalled();
    updates.apply();
    c.dispatchEvent(new Event('controllerchange'));
    c.dispatchEvent(new Event('controllerchange'));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('check() asks the registration for an update; a rejection is swallowed', async () => {
    const { c, updates } = setup();
    await flush();
    c.reg.update.mockRejectedValueOnce(new Error('offline'));
    updates.check();
    await flush();
    expect(c.reg.update).toHaveBeenCalledTimes(1);
  });

  it('dispose() stops listening for controllerchange', async () => {
    const c = new FakeContainer();
    c.reg.waiting = new FakeWorker();
    const { updates, onReload } = setup(c);
    await flush();
    updates.apply();
    updates.dispose();
    c.dispatchEvent(new Event('controllerchange'));
    expect(onReload).not.toHaveBeenCalled();
  });
});
