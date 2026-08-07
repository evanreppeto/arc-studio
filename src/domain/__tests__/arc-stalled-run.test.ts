import { describe, expect, it } from "vitest";

import { ARC_RUN_STALE_MS, arcStalledMessage, decideArcRunStalled } from "../arc-stalled-run";

const NOW = Date.parse("2026-08-05T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("decideArcRunStalled", () => {
  it("leaves a fresh pending run alone", () => {
    expect(
      decideArcRunStalled({
        status: "pending",
        createdAt: iso(5_000),
        task: { status: "running", startedAt: iso(5_000), createdAt: iso(6_000) },
        nowMs: NOW,
      }),
    ).toEqual({ stalled: false });
  });

  it("leaves a long-but-live run alone right up to the cutoff", () => {
    // The failure mode that matters most: a real campaign build runs for
    // minutes. Calling it dead is worse than spinning a little longer.
    expect(
      decideArcRunStalled({
        status: "pending",
        createdAt: iso(ARC_RUN_STALE_MS - 1_000),
        task: { status: "running", startedAt: iso(ARC_RUN_STALE_MS - 1_000), createdAt: null },
        nowMs: NOW,
      }),
    ).toEqual({ stalled: false });
  });

  it("calls a pending reply stranded the moment its task settles", () => {
    // No timing involved — the queue finished and no reply was written.
    for (const status of ["completed", "failed", "canceled"]) {
      expect(
        decideArcRunStalled({
          status: "pending",
          createdAt: iso(2_000),
          task: { status, startedAt: iso(2_000), createdAt: null },
          nowMs: NOW,
        }),
      ).toEqual({ stalled: true, reason: "task_settled" });
    }
  });

  it("times out a run still marked running past the cutoff", () => {
    expect(
      decideArcRunStalled({
        status: "pending",
        createdAt: iso(ARC_RUN_STALE_MS + 1_000),
        task: { status: "running", startedAt: iso(ARC_RUN_STALE_MS + 1_000), createdAt: null },
        nowMs: NOW,
      }),
    ).toEqual({ stalled: true, reason: "timed_out" });
  });

  it("treats blocked and needs_approval as waiting on a human, not dead", () => {
    for (const status of ["blocked", "needs_approval"]) {
      expect(
        decideArcRunStalled({
          status: "pending",
          createdAt: iso(1_000),
          task: { status, startedAt: iso(1_000), createdAt: null },
          nowMs: NOW,
        }),
      ).toEqual({ stalled: false });
    }
  });

  it("re-stamped started_at from a reclaim retry reads as freshly started", () => {
    expect(
      decideArcRunStalled({
        status: "pending",
        // The message is old; the task was handed back out a moment ago.
        createdAt: iso(ARC_RUN_STALE_MS * 3),
        task: { status: "running", startedAt: iso(2_000), createdAt: iso(ARC_RUN_STALE_MS * 3) },
        nowMs: NOW,
      }),
    ).toEqual({ stalled: false });
  });

  it("falls back to the message clock when there is no task row", () => {
    expect(
      decideArcRunStalled({ status: "pending", createdAt: iso(ARC_RUN_STALE_MS + 1), task: null, nowMs: NOW }),
    ).toEqual({ stalled: true, reason: "timed_out" });
    // A just-sent message whose task row hasn't been created yet must not be
    // mistaken for a dead one.
    expect(decideArcRunStalled({ status: "pending", createdAt: iso(500), task: null, nowMs: NOW })).toEqual({
      stalled: false,
    });
  });

  it("never re-judges a settled message", () => {
    for (const status of ["complete", "failed", "sent"]) {
      expect(
        decideArcRunStalled({
          status,
          createdAt: iso(ARC_RUN_STALE_MS * 10),
          task: { status: "failed", startedAt: iso(ARC_RUN_STALE_MS * 10), createdAt: null },
          nowMs: NOW,
        }),
      ).toEqual({ stalled: false });
    }
  });

  it("treats an unparseable clock as no evidence rather than death", () => {
    expect(
      decideArcRunStalled({ status: "pending", createdAt: "not-a-date", task: null, nowMs: NOW }),
    ).toEqual({ stalled: false });
  });

  it("honors an explicit staleMs override", () => {
    expect(
      decideArcRunStalled({ status: "pending", createdAt: iso(2_000), task: null, nowMs: NOW, staleMs: 1_000 }),
    ).toEqual({ stalled: true, reason: "timed_out" });
  });
});

describe("arcStalledMessage", () => {
  it("tells the operator nothing went out, in both reasons", () => {
    for (const reason of ["task_settled", "timed_out"] as const) {
      const message = arcStalledMessage(reason);
      expect(message).toMatch(/nothing was sent/i);
      expect(message).toMatch(/try again/i);
      // Owner-operator register: no ids, no status enums, no tool names.
      expect(message).not.toMatch(/agent_task|pending|uuid|null/i);
    }
  });
});

describe("the stale cutoff itself", () => {
  /**
   * Pinned deliberately. At 3min this fired on the slowest ~5% of HEALTHY prod
   * turns (n=55: p95 174s, p99 216s, max 232s), telling the operator "Arc
   * stopped responding, nothing was sent" about work that then delivered a
   * reply. Nothing bounds a run in wall-clock — the runner's rails are
   * turn-based — so this is a generous backstop, and the strong signal
   * (terminal task status) is what catches a real death.
   */
  it("is 10 minutes", () => {
    expect(ARC_RUN_STALE_MS).toBe(10 * 60_000);
  });

});
