/**
 * A display preference that survives reload, shaped for `useSyncExternalStore`.
 *
 * Two wrong shapes bracket this one, and both were written before it (BSR-748):
 *
 *   useState(read())            hydration mismatch — the server has no
 *                               localStorage and always renders the default
 *   useState + read in effect   a synchronous setState on mount, i.e. a
 *                               cascading render; `react-hooks` rejects it
 *
 * `useSyncExternalStore` exists for exactly this: a server snapshot that is
 * always the default, a client snapshot read on demand. Cross-tab sync falls
 * out of the `storage` event for free.
 *
 * Factored out because the second caller (column visibility) would otherwise
 * have copied forty lines of the same subtle plumbing — and the subtlety is the
 * whole point: `getSnapshot` MUST be referentially stable between renders or
 * React re-renders forever, which is why the value is cached rather than parsed
 * on every call.
 */
export type StoredPreference<T> = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  /** Write, persist, and notify every mounted subscriber. */
  set: (next: T) => void;
};

export function createStoredPreference<T>({
  key,
  fallback,
  parse,
  serialize = JSON.stringify,
}: {
  key: string;
  /** What the server renders, and what any unreadable value resolves to. */
  fallback: T;
  /** Total: every input, including null and malformed JSON, yields a T. */
  parse: (raw: string | null) => T;
  serialize?: (value: T) => string;
}): StoredPreference<T> {
  const listeners = new Set<() => void>();
  // Cached so `getSnapshot` returns the SAME reference until something changes.
  // Re-parsing per call would hand React a new object every render and loop.
  let cache: { value: T } | null = null;

  const read = (): T => {
    if (cache) return cache.value;
    try {
      cache = { value: parse(window.localStorage.getItem(key)) };
    } catch {
      // Private mode can throw on read, not just on write.
      cache = { value: fallback };
    }
    return cache.value;
  };

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      const onStorage = (event: StorageEvent) => {
        if (event.key !== key) return;
        cache = null;
        onChange();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot: read,
    getServerSnapshot: () => fallback,
    set(next) {
      cache = { value: next };
      try {
        window.localStorage.setItem(key, serialize(next));
      } catch {
        // Quota or private mode. The choice still applies for this session; a
        // display preference is not worth surfacing an error for.
      }
      for (const listener of listeners) listener();
    },
  };
}
