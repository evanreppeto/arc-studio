import { describe, expect, it } from "vitest";

import { reasonOnly, relativeTime, scanStatusLine } from "./scan-status-copy";
import type { ScanStatus } from "@/lib/opportunities/scan-status";

const NOW = Date.parse("2026-08-04T16:00:00Z");

function status(over: Partial<ScanStatus>): ScanStatus {
  return { outcome: "empty", startedAt: null, finishedAt: null, proposed: null, detail: null, ...over };
}

describe("relativeTime", () => {
  it("keeps it coarse", () => {
    expect(relativeTime("2026-08-04T15:59:30Z", NOW)).toBe("just now");
    expect(relativeTime("2026-08-04T15:46:00Z", NOW)).toBe("14m ago");
    expect(relativeTime("2026-08-04T13:00:00Z", NOW)).toBe("3h ago");
    expect(relativeTime("2026-08-02T13:00:00Z", NOW)).toBe("2d ago");
  });

  it("says nothing when there is no timestamp to describe", () => {
    expect(relativeTime(null, NOW)).toBe("");
    expect(relativeTime("not-a-date", NOW)).toBe("");
  });
});

describe("reasonOnly", () => {
  it("drops the runner's bookkeeping, keeping Arc's words", () => {
    expect(
      reasonOnly("Opportunity scan complete — proposed 0 opportunity(ies). Arc's reason: everything is already open."),
    ).toBe("everything is already open.");
  });

  // Tasks from before the runner recorded a reason carry ONLY the prefix, so
  // stripping it must leave nothing rather than an echo of the line above.
  it("returns null when the summary was only a count", () => {
    expect(reasonOnly("Opportunity scan complete — proposed 0 opportunity(ies).")).toBeNull();
    expect(reasonOnly("Opportunity scan complete — proposed 2 opportunity(ies).")).toBeNull();
  });

  it("leaves an unrecognised detail alone", () => {
    expect(reasonOnly("Arc hit an error: boom")).toBe("Arc hit an error: boom");
    expect(reasonOnly(null)).toBeNull();
  });
});

describe("scanStatusLine", () => {
  it("distinguishes all six outcomes", () => {
    const lines = (["never", "running", "stalled", "failed", "added", "empty"] as const).map(
      (outcome) =>
        scanStatusLine(status({ outcome, startedAt: "2026-08-04T13:00:00Z", finishedAt: "2026-08-04T13:02:00Z", proposed: 2 }), NOW)!
          .text,
    );

    // The defect this guards: every one of these rendered as the same unchanged
    // inbox, so a broken scan looked exactly like a healthy quiet day.
    expect(new Set(lines).size).toBe(6);
  });

  it("reports a scan that added work", () => {
    const line = scanStatusLine(
      status({ outcome: "added", proposed: 3, finishedAt: "2026-08-04T13:02:00Z" }),
      NOW,
    );
    expect(line!.text).toBe("Arc scanned 3h ago and added 3 opportunities.");
    expect(line!.tone).toBe("ok");
  });

  it("counts one opportunity singular", () => {
    expect(scanStatusLine(status({ outcome: "added", proposed: 1, finishedAt: "2026-08-04T13:02:00Z" }), NOW)!.text).toContain(
      "added 1 opportunity.",
    );
  });

  // Arc looked and judged there was nothing new — a result, not an absence.
  it("carries Arc's reason when it found nothing", () => {
    const line = scanStatusLine(
      status({
        outcome: "empty",
        finishedAt: "2026-08-04T13:02:00Z",
        detail: "Every gap I can see is already open in the inbox.",
      }),
      NOW,
    );
    expect(line!.text).toBe("Arc scanned 3h ago and found nothing new.");
    expect(line!.detail).toBe("Every gap I can see is already open in the inbox.");
    expect(line!.tone).toBe("muted");
  });

  /**
   * 2026-08-04: the scan finished its work, could not mark itself complete, and
   * sat in `queued` for hours. Calling that "scanning now" would be a comforting
   * lie, and calling it nothing at all is what actually happened.
   */
  it("says a stalled scan never finished, and flags it", () => {
    const line = scanStatusLine(status({ outcome: "stalled", startedAt: "2026-08-04T13:00:00Z" }), NOW);
    expect(line!.text).toBe("Arc's scan started 3h ago and never finished.");
    expect(line!.tone).toBe("warn");
  });

  it("flags a failed scan with its error", () => {
    const line = scanStatusLine(
      status({ outcome: "failed", finishedAt: "2026-08-04T13:01:00Z", detail: "Arc hit an error: boom" }),
      NOW,
    );
    expect(line!.text).toBe("Arc's last scan 3h ago failed.");
    expect(line!.detail).toBe("Arc hit an error: boom");
    expect(line!.tone).toBe("warn");
  });

  it("is calm about a workspace that has never been scanned", () => {
    const line = scanStatusLine(status({ outcome: "never" }), NOW);
    expect(line!.text).toBe("Arc hasn't scanned this workspace yet.");
    expect(line!.tone).toBe("muted");
  });

  it("never dangles a time it does not have", () => {
    for (const outcome of ["stalled", "failed", "added", "empty"] as const) {
      const line = scanStatusLine(status({ outcome, proposed: 1 }), NOW);
      expect(line!.text).not.toContain("  ");
      expect(line!.text).not.toMatch(/\s\./);
    }
  });
});

/**
 * `never` and `unknown` are different claims and must not render alike.
 *
 * `never` says something about Arc — "it has not scanned this workspace" — and
 * in the offline preview that sentence rendered directly above five
 * opportunities each labelled "Found by Arc", with confidence scores and Arc's
 * own reasoning beneath them. One screen contradicting itself, because a read
 * that could not happen was reported as a fact about the agent.
 */
describe("a scan nobody could look up is not a scan that never happened", () => {
  it("says nothing at all when there was no backend to ask", () => {
    expect(scanStatusLine(status({ outcome: "unknown" }), NOW)).toBeNull();
  });

  it("still says the calm thing when the workspace genuinely has no history", () => {
    const line = scanStatusLine(status({ outcome: "never" }), NOW);
    expect(line).not.toBeNull();
    expect(line!.text).toBe("Arc hasn't scanned this workspace yet.");
  });

  it("returns a line for every outcome that IS a fact about a scan", () => {
    // A new outcome added without a branch would fall to the `empty` default and
    // silently claim "Arc scanned and found nothing new".
    for (const outcome of ["never", "running", "stalled", "failed", "added", "empty"] as const) {
      expect(scanStatusLine(status({ outcome }), NOW), outcome).not.toBeNull();
    }
  });
});
