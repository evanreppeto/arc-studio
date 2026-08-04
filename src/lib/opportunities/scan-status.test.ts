import { describe, expect, it } from "vitest";

import { classifyScanTask } from "./scan-status";

const NOW = Date.parse("2026-08-04T16:00:00Z");

describe("classifyScanTask", () => {
  it("reports never when the workspace has no scan history", () => {
    expect(classifyScanTask(null, NOW)).toEqual({
      outcome: "never",
      startedAt: null,
      finishedAt: null,
      proposed: null,
      detail: null,
    });
  });

  it("counts what a completed scan proposed", () => {
    const status = classifyScanTask(
      {
        status: "completed",
        created_at: "2026-08-03T13:00:47Z",
        started_at: null,
        completed_at: "2026-08-03T13:02:41Z",
        metadata: {
          completion_summary: "Opportunity scan complete — proposed 2 opportunity(ies).",
          outputs: { actions: [{ title: "a" }, { title: "b" }] },
        },
      },
      NOW,
    );

    expect(status.outcome).toBe("added");
    expect(status.proposed).toBe(2);
    expect(status.finishedAt).toBe("2026-08-03T13:02:41Z");
  });

  it("separates a considered empty scan from one that added work", () => {
    const status = classifyScanTask(
      {
        status: "completed",
        created_at: "2026-08-04T13:00:50Z",
        started_at: null,
        completed_at: "2026-08-04T13:01:34Z",
        metadata: {
          completion_summary:
            "Opportunity scan complete — proposed 0 opportunity(ies). Arc's reason: everything is already open.",
          outputs: { actions: [] },
        },
      },
      NOW,
    );

    expect(status.outcome).toBe("empty");
    expect(status.proposed).toBe(0);
    expect(status.detail).toContain("already open");
  });

  /**
   * The 2026-08-04 incident, as the data actually looked: the scan ran, could
   * not post its own completion, and the row stayed `queued` for hours with no
   * `completed_at`. Nothing in the product distinguished that from a scan about
   * to start, or from a healthy quiet day.
   */
  it("calls a long-queued scan stalled, not running", () => {
    const row = {
      status: "queued",
      created_at: "2026-08-04T13:00:50Z",
      started_at: null,
      completed_at: null,
      metadata: null,
    };

    expect(classifyScanTask(row, NOW).outcome).toBe("stalled");
  });

  it("still calls a freshly queued scan running", () => {
    const row = {
      status: "queued",
      created_at: "2026-08-04T15:58:00Z",
      started_at: null,
      completed_at: null,
      metadata: null,
    };

    expect(classifyScanTask(row, NOW).outcome).toBe("running");
  });

  it("treats a blocked scan as failed and surfaces the reason", () => {
    const status = classifyScanTask(
      {
        status: "blocked",
        created_at: "2026-08-04T13:00:50Z",
        started_at: null,
        completed_at: "2026-08-04T13:01:34Z",
        metadata: { blocked_reason: "Arc hit an error running the opportunity scan: boom" },
      },
      NOW,
    );

    expect(status.outcome).toBe("failed");
    expect(status.detail).toContain("boom");
  });

  // Tasks written before the runner recorded outputs still have to classify.
  it("survives a task from before any of this was recorded", () => {
    const status = classifyScanTask(
      {
        status: "completed",
        created_at: "2026-08-01T13:00:46Z",
        started_at: null,
        completed_at: "2026-08-01T13:03:06Z",
        metadata: {},
      },
      NOW,
    );

    // No recorded count is not the same as a recorded zero, but both mean there
    // is nothing to show — `empty` is the honest bucket, and `proposed` stays
    // null so the copy never claims a number it does not have.
    expect(status.outcome).toBe("empty");
    expect(status.proposed).toBeNull();
    expect(status.detail).toBeNull();
  });
});
