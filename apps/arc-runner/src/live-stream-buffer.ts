export type CumulativeStreamBuffer = {
  append(delta: string): Promise<void>;
  /** Replace the whole snapshot, throttled like `append`. For a stream whose
   *  content can be revised — a chunk reclassified as narration and pulled out
   *  of the reply — not only extended. */
  set(value: string): Promise<void>;
  flush(finalValue?: string): Promise<void>;
  value(): string;
};

/**
 * Accumulates model deltas into snapshots suitable for the app's streaming API.
 * Emissions are throttled during a run and `flush` guarantees that the last
 * snapshot exactly matches the canonical value before the message completes.
 */
export function createCumulativeStreamBuffer(options: {
  onEmit?: (value: string) => void | Promise<void>;
  throttleMs: number;
  now?: () => number;
}): CumulativeStreamBuffer {
  const now = options.now ?? Date.now;
  let buffer = "";
  let lastEmitted = "";
  let lastEmittedAt: number | null = null;

  const emit = async (at: number) => {
    if (!options.onEmit || !buffer || buffer === lastEmitted) return;
    await options.onEmit(buffer);
    lastEmitted = buffer;
    lastEmittedAt = at;
  };

  return {
    async append(delta) {
      if (!delta) return;
      buffer += delta;
      const at = now();
      if (lastEmittedAt === null || at - lastEmittedAt >= options.throttleMs) {
        await emit(at);
      }
    },
    async set(value) {
      if (value === buffer) return;
      buffer = value;
      const at = now();
      if (lastEmittedAt === null || at - lastEmittedAt >= options.throttleMs) {
        await emit(at);
      }
    },
    async flush(finalValue) {
      if (typeof finalValue === "string") buffer = finalValue;
      await emit(now());
    },
    value() {
      return buffer;
    },
  };
}
