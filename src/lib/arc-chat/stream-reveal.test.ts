import { describe, expect, it } from "vitest";

import { MAX_CPS, revealAdvance, revealCharsPerSecond, SETTLE_LAG_SECONDS, STREAM_LAG_SECONDS } from "./stream-reveal";

const FRAME_MS = 1000 / 60;

/**
 * Play a whole reply through the reveal loop at 60fps, with text arriving in
 * chunks the way the SSE route actually delivers it, and record what the reader
 * would see frame by frame.
 */
function simulate({
  replyLength,
  chunkChars,
  arrivalMs,
}: {
  replyLength: number;
  chunkChars: number;
  arrivalMs: number;
}) {
  const frames: { received: number; revealed: number; advance: number; streaming: boolean }[] = [];
  let received = 0;
  let revealed = 0;
  let elapsed = 0;
  let nextArrival = 0;

  // Stream until everything has arrived, then keep running while the reveal
  // settles — the phase that used to be a single snap.
  while (revealed < replyLength && elapsed < 120_000) {
    if (elapsed >= nextArrival && received < replyLength) {
      received = Math.min(replyLength, received + chunkChars);
      nextArrival = elapsed + arrivalMs;
    }
    const streaming = received < replyLength;
    const advance = revealAdvance(received - revealed, FRAME_MS, streaming);
    revealed += advance;
    frames.push({ received, revealed, advance, streaming });
    elapsed += FRAME_MS;
  }
  return { frames, elapsed };
}

describe("revealCharsPerSecond", () => {
  it("trails the received text rather than draining it", () => {
    // 200 hidden characters over a 0.55s target lag ≈ 364 chars/sec. The old
    // curve (remaining * 5) would have run at 1000 — draining in 200ms, well
    // before the next chunk lands, which is what caused the stalling.
    expect(Math.round(revealCharsPerSecond(200, true))).toBe(364);
    expect(revealCharsPerSecond(200, true)).toBeLessThan(200 * 5);
  });

  it("never crawls and never teleports", () => {
    expect(revealCharsPerSecond(1, true)).toBe(40);
    expect(revealCharsPerSecond(1_000_000, true)).toBe(MAX_CPS);
  });

  it("closes the tail faster once nothing more is coming", () => {
    expect(revealCharsPerSecond(200, false)).toBeGreaterThan(revealCharsPerSecond(200, true));
  });

  it("has nothing to do when nothing is hidden", () => {
    expect(revealCharsPerSecond(0, true)).toBe(0);
    expect(revealAdvance(0, FRAME_MS, true)).toBe(0);
  });
});

describe("the reveal a reader actually sees", () => {
  // The reported symptom: "it stops too, then prints the whole thing."
  const cases = [
    { name: "active cadence", chunkChars: 60, arrivalMs: 120 },
    { name: "relaxed cadence", chunkChars: 180, arrivalMs: 500 },
  ];

  it.each(cases)("does not stall between chunks — $name", ({ chunkChars, arrivalMs }) => {
    const { frames } = simulate({ replyLength: 3000, chunkChars, arrivalMs });
    // A stall is a frame that reveals nothing while text is still outstanding.
    const midStream = frames.filter((f) => f.streaming);
    const stalled = midStream.filter((f) => f.advance === 0 && f.received > f.revealed);
    expect(stalled).toHaveLength(0);

    // And it should never be caught up to the byte mid-stream, which is the
    // state the old curve sat in — nothing moving until the next chunk.
    const caughtUp = midStream.filter((f) => f.revealed >= f.received).length;
    expect(caughtUp / midStream.length).toBeLessThan(0.1);
  });

  it.each(cases)("never dumps a visible chunk in one frame — $name", ({ chunkChars, arrivalMs }) => {
    const { frames } = simulate({ replyLength: 3000, chunkChars, arrivalMs });
    const biggest = Math.max(...frames.map((f) => f.advance));
    // At 60fps the ceiling allows 20 characters a frame; a "dump" would be the
    // whole outstanding tail landing at once.
    expect(biggest).toBeLessThanOrEqual(Math.ceil((MAX_CPS * FRAME_MS) / 1000));
    expect(biggest).toBeLessThan(chunkChars);
  });

  it("animates the ending instead of snapping to full", () => {
    const { frames } = simulate({ replyLength: 3000, chunkChars: 180, arrivalMs: 500 });
    const settleFrames = frames.filter((f) => !f.streaming);
    const settleMs = settleFrames.length * FRAME_MS;

    // Closed over many frames rather than the single frame that used to dump
    // the whole outstanding tail...
    expect(settleFrames.length).toBeGreaterThan(3);
    // ...and it still finishes promptly. The reveal is trailing by roughly a
    // chunk when the run ends, and that decays with the settle lag as its time
    // constant, so the last characters take a few multiples of it to arrive —
    // under a second, which reads as the sentence finishing rather than a wait.
    expect(settleMs).toBeLessThan(1000);
    // Decisively quicker than it would have finished at streaming pace.
    expect(settleMs).toBeLessThan((STREAM_LAG_SECONDS / SETTLE_LAG_SECONDS) * 1000);
  });

  it("reveals every character exactly once, in order", () => {
    const { frames } = simulate({ replyLength: 1200, chunkChars: 60, arrivalMs: 120 });
    expect(frames[frames.length - 1]!.revealed).toBe(1200);
    // Monotonic: the reveal never goes backwards.
    const revealedSeries = frames.map((f) => f.revealed);
    expect([...revealedSeries].sort((a, b) => a - b)).toEqual(revealedSeries);
    // Never reveals text it hasn't received.
    expect(frames.every((f) => f.revealed <= f.received)).toBe(true);
  });
});
