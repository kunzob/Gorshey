// Per-tab presence key. sessionStorage keeps it across reloads of one tab; if storage is blocked, an in-memory key is used.
let memoryKey: string | null = null;

function newKey(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `tab-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
}

export function tabKey(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.sessionStorage): string {
  try {
    const stored = storage?.getItem('gorshey.presenceKey');
    if (stored) return stored;
    const key = newKey();
    storage?.setItem('gorshey.presenceKey', key);
    return key;
  } catch {
    memoryKey ??= newKey();
    return memoryKey;
  }
}
