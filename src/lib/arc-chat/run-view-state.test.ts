import { describe, expect, it } from "vitest";

import { resolveArcRunViewState } from "./run-view-state";

describe("resolveArcRunViewState", () => {
  it("keeps a queued run visibly active while the request is pending", () => {
    expect(resolveArcRunViewState({
      pending: true,
      rows: [{ status: "queued" }, { status: "queued" }, { status: "queued" }],
    })).toMatchObject({
      state: "working",
      label: "Arc is working",
      progressLabel: "0/3 activities",
    });
  });

  it("reports failures consistently even when earlier work completed", () => {
    expect(resolveArcRunViewState({
      pending: false,
      messageStatus: "failed",
      rows: [{ status: "done" }, { status: "error" }],
    })).toMatchObject({
      state: "failed",
      label: "Needs attention",
    });
  });

  it("does not call an empty inspector complete", () => {
    expect(resolveArcRunViewState({ pending: false })).toMatchObject({
      state: "idle",
      label: "Ready",
    });
  });

  it("keeps a persisted completed run complete when an activity row is stale", () => {
    expect(resolveArcRunViewState({
      pending: false,
      messageStatus: "complete",
      rows: [{ status: "done" }, { status: "running" }],
      hasContent: true,
    })).toMatchObject({
      state: "complete",
      label: "Run complete",
    });
  });

  it("surfaces limitations without reopening a completed run", () => {
    expect(resolveArcRunViewState({
      pending: false,
      messageStatus: "complete",
      rows: [{ status: "done" }, { status: "error" }],
      hasContent: true,
    })).toMatchObject({
      state: "complete",
      label: "Completed with limitations",
      hasWarnings: true,
    });
  });

  it("calls a run whose every failure was retried simply complete", () => {
    // Prod run 7631013c after the run-level fix still read "Completed with
    // limitations · 19/22": the verdict was right and the label was not, because
    // three recovered calls were still counted as failures. There were no
    // limitations — Arc reloaded the schemas and every activity resolved.
    expect(resolveArcRunViewState({
      pending: false,
      messageStatus: "complete",
      rows: [{ status: "done" }, { status: "retried" }, { status: "retried" }, { status: "retried" }],
      hasContent: true,
    })).toMatchObject({
      state: "complete",
      label: "Run complete",
      progressLabel: "4/4 activities",
      hasWarnings: false,
    });
  });

  it("still says limitations when a failure was never recovered", () => {
    expect(resolveArcRunViewState({
      pending: false,
      messageStatus: "complete",
      rows: [{ status: "done" }, { status: "retried" }, { status: "error" }],
      hasContent: true,
    })).toMatchObject({
      state: "complete",
      label: "Completed with limitations",
      // The retry counts as resolved; the unrecovered error does not.
      progressLabel: "2/3 activities",
      hasWarnings: true,
    });
  });
});
