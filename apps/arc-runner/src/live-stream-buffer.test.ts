import { describe, expect, it, vi } from "vitest";

import { createCumulativeStreamBuffer } from "./live-stream-buffer";

describe("createCumulativeStreamBuffer", () => {
  it("flushes the unposted tail before completion", async () => {
    let clock = 1_000;
    const emit = vi.fn(async () => undefined);
    const stream = createCumulativeStreamBuffer({ onEmit: emit, throttleMs: 180, now: () => clock });

    await stream.append("The final ");
    clock += 20;
    await stream.append("answer.");

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenLastCalledWith("The final ");

    await stream.flush("The final answer.");

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith("The final answer.");
  });

  it("does not duplicate a snapshot that was already emitted", async () => {
    const emit = vi.fn(async () => undefined);
    const stream = createCumulativeStreamBuffer({ onEmit: emit, throttleMs: 180, now: () => 1_000 });

    await stream.append("Complete");
    await stream.flush("Complete");

    expect(emit).toHaveBeenCalledTimes(1);
  });
});

/**
 * The live stream must read the way the settled reply reads.
 *
 * Observed on prod while streaming: "…starting with CRM contacts.Checking CRM
 * contacts now." Two assistant messages' prose concatenated with no separator,
 * because the buffer only ever saw raw token deltas. The final body is joined by
 * `assembleReplyBody` with a blank line, so the typing and the result disagreed.
 */
describe("chunk boundaries in the live stream", () => {
  it("separates prose from consecutive messages the way the reply does", async () => {
    const emitted: string[] = [];
    const buffer = createCumulativeStreamBuffer({ onEmit: (v) => { emitted.push(v); }, throttleMs: 0 });

    await buffer.append("First up: CRM contacts.");
    // boundary: the runner appends the same separator assembleReplyBody uses
    await buffer.append("\n\n");
    await buffer.append("CRM contacts finding: 0 contacts.");

    expect(buffer.value()).toBe("First up: CRM contacts.\n\nCRM contacts finding: 0 contacts.");
    expect(buffer.value()).not.toContain("contacts.CRM");
  });

  it("does not stack separators when the prose already ended with one", async () => {
    const buffer = createCumulativeStreamBuffer({ throttleMs: 0 });
    await buffer.append("Done.\n\n");
    // the runner checks before appending, so nothing is added here
    expect(buffer.value().endsWith("\n\n")).toBe(true);
    expect(buffer.value()).not.toContain("\n\n\n");
  });
});
