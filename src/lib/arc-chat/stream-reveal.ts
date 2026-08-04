/**
 * How fast the streamed reply types itself out.
 *
 * Text does not arrive token by token: the runner writes partial bodies to the
 * database and the SSE route polls it every 120ms while a run is active,
 * relaxing to 500ms when nothing changes. So the client receives chunks, and the
 * reveal exists to turn those steps back into typing.
 *
 * The rate is paced against *arrival*, not against emptying the buffer. The
 * previous curve (`max(45, remaining * 5)`) drained whatever it held in ~200ms —
 * far quicker than the next chunk lands — so it sprinted, ran dry, sat still,
 * and sprinted again. Deliberately trailing the received text by
 * STREAM_LAG_SECONDS keeps the reveal moving when the next chunk arrives.
 *
 * Ending the run means no more text is coming; it does not mean the rest should
 * teleport. Snapping to full was the "and then it prints the whole thing" at the
 * end of a reply, and it got worse the further the reveal trailed — so the tail
 * closes over SETTLE_LAG_SECONDS instead, quick but still animated.
 */

/** How far behind the received text the reveal aims to sit while streaming. */
export const STREAM_LAG_SECONDS = 0.55;
/** How quickly the remaining tail closes once no more text is coming. */
export const SETTLE_LAG_SECONDS = 0.16;
/** Floor, so the last few characters of a chunk don't crawl. */
export const MIN_CPS = 40;
/** Ceiling, so an enormous backlog (a backgrounded tab, a slow first paint)
 *  resolves without a single frame dumping thousands of characters. */
export const MAX_CPS = 1200;

export function revealCharsPerSecond(remaining: number, streaming: boolean): number {
  if (remaining <= 0) return 0;
  const lag = streaming ? STREAM_LAG_SECONDS : SETTLE_LAG_SECONDS;
  return Math.min(Math.max(remaining / lag, MIN_CPS), MAX_CPS);
}

/** Characters to reveal for a frame of `dtMs`, given how many are still hidden. */
export function revealAdvance(remaining: number, dtMs: number, streaming: boolean): number {
  if (remaining <= 0) return 0;
  const cps = revealCharsPerSecond(remaining, streaming);
  return Math.min(remaining, Math.max(1, Math.round((cps * dtMs) / 1000)));
}
