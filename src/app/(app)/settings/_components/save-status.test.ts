import { describe, expect, it } from "vitest";

import { toStatus } from "./save-status";

/**
 * This function used to always show the caller's hardcoded okText, so every
 * `message` an action returned was computed and discarded at the last inch.
 * The weather probe's alert count, its forecast, and the service-area coverage
 * warning (BSR-756) had never once reached an operator.
 *
 * It was found by clicking the button on prod. No test could have caught it,
 * because none existed — which is the actual lesson.
 */
describe("toStatus", () => {
  it("shows what the action actually said", () => {
    expect(
      toStatus({ ok: true, persisted: true, message: "NWS reachable — 2 active alert(s) for 5 point(s)." }, "Healthy."),
    ).toEqual({ tone: "ok", text: "NWS reachable — 2 active alert(s) for 5 point(s)." });
  });

  it("carries a warning that rides on the success message", () => {
    // The coverage warning is appended to a SUCCEEDING probe: connectivity is
    // fine, the geography is not. If only okText renders, it is invisible.
    const warning = "NWS reachable — 0 alert(s). ⚠ 3 of 4 monitored point(s) resolve outside your service area.";
    expect(toStatus({ ok: true, persisted: true, message: warning }, "Healthy.")).toEqual({ tone: "ok", text: warning });
  });

  it("falls back to okText when the action had nothing specific to say", () => {
    expect(toStatus({ ok: true, persisted: true }, "Saved.")).toEqual({ tone: "ok", text: "Saved." });
    expect(toStatus({ ok: true, persisted: true, message: "   " }, "Saved.")).toEqual({ tone: "ok", text: "Saved." });
  });

  it("keeps the not-persisted hint alongside the real message", () => {
    expect(toStatus({ ok: true, persisted: false, message: "Checked." }, "Saved.")).toEqual({
      tone: "ok",
      text: "Checked. — connect your workspace to persist.",
    });
  });

  it("reports a failure with the error, never the okText", () => {
    expect(toStatus({ ok: false, error: "NWS unreachable" }, "Healthy.")).toEqual({ tone: "err", text: "NWS unreachable" });
  });
});
