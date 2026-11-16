// A short-lived cache shared by everyone viewing the same data. Screens refresh every 15 seconds, so without it the
// server repeated the same expensive calculation once per open screen. With it, the work is done at most once per
// window however many people are watching, and requests that arrive while it is running wait for that one result.
// Any change made through the API clears it (see clearOnChange), so a saved outcome shows on the next refresh.

export interface SharedCache {
  get<T>(key: string, compute: () => Promise<T>): Promise<T>;
  clear(): void;
  size(): number;
}

export function createSharedCache(ttlMs: number, now: () => number = Date.now): SharedCache {
  const entries = new Map<string, { at: number; value: Promise<unknown>; generation: number }>();
  let generation = 0;
  return {
    get<T>(key: string, compute: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.value as Promise<T>;
      const myGeneration = generation;
      const value = compute();
      entries.set(key, { at: now(), value, generation: myGeneration });
      // A failure is never cached: the next request tries again.
      value.catch(() => {
        const current = entries.get(key);
        if (current && current.value === value) entries.delete(key);
      });
      return value;
    },
    clear() {
      generation += 1;
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}
