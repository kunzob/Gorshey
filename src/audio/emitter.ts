export type Unsubscribe = () => void;

/** Tiny typed event emitter. Handlers are per event name; `clear()` drops them all. */
export class Emitter<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<(payload: unknown) => void>>();

  on<K extends keyof Events>(event: K, cb: (payload: Events[K]) => void): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    const handler = cb as (payload: unknown) => void;
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.handlers.get(event)?.forEach((cb) => cb(payload));
  }

  clear(): void {
    this.handlers.clear();
  }
}
