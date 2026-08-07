import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DISPATCH_STATUS_ORDER } from "@/lib/dispatch/status";

const ACTIONS = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const PERSISTENCE = readFileSync(new URL("../../../lib/dispatch/persistence.ts", import.meta.url), "utf8");
const EXECUTE = readFileSync(new URL("../../../lib/dispatch/execute-resend.ts", import.meta.url), "utf8");

/**
 * `sent` means mail left the building, and only one code path can honestly say
 * so.
 *
 * `executeResendDispatch` re-checks the approval gate and the ARC_SEND_ENABLED
 * kill-switch, talks to Resend, and records the provider id.
 * `transitionDispatch` does none of that — it stamps the status, sets
 * `dispatched_at`, and writes a "dispatch sent" campaign event. Both could write
 * the same row, and afterwards nothing distinguishes them.
 *
 * The UI never asked for it. But a server action is a public endpoint, and the
 * outbound ledger is the one record the whole approval posture rests on.
 */
describe("only an actual send can mark a dispatch sent", () => {
  it("refuses `sent` from the bookkeeping action", () => {
    expect(ACTIONS).toContain('if (to === "sent") {');
    expect(ACTIONS).toMatch(/A dispatch becomes sent by sending it/);
  });

  it("keeps every other lifecycle status reachable", () => {
    // The refusal must be surgical: cancel, retry-to-queued and confirm-delivered
    // are all real operator moves and must keep working.
    expect(ACTIONS).toContain('DISPATCH_STATUS_ORDER.filter((status) => status !== "sent")');
    for (const status of DISPATCH_STATUS_ORDER) {
      if (status === "sent") continue;
      expect(DISPATCH_STATUS_ORDER).toContain(status);
    }
  });

  it("leaves the real send path writing `sent` itself", () => {
    // The fix must not have moved the burden onto a path that cannot carry it:
    // executeResendDispatch writes the row directly rather than going through
    // transitionDispatch, so excluding `sent` above costs it nothing.
    expect(EXECUTE).toMatch(/status: "sent"/);
    expect(EXECUTE).not.toMatch(/transitionDispatch\(/);
  });
});

describe("the UI's own routing agrees", () => {
  it("routes a real send through sendDispatchAction, not the status stamp", () => {
    expect(PAGE).toContain('const SEND_ACTIONS: ReadonlySet<DispatchStatus> = new Set<DispatchStatus>(["queued", "scheduled"]);');
    expect(PAGE).toMatch(/queued: "sent"/);
    expect(PAGE).toMatch(/scheduled: "sent"/);
  });

  it("never asks the bookkeeping action for `sent`", () => {
    // Every ACTION_TARGET whose value is "sent" must belong to SEND_ACTIONS, or
    // the UI would hit the refusal above and the button would simply fail.
    const targets = [...PAGE.matchAll(/^\s*(\w+): "(\w+)",$/gm)]
      .filter(([, , to]) => to === "sent")
      .map(([, from]) => from);
    expect(targets.sort()).toEqual(["queued", "scheduled"]);
  });
});

describe("the transition writer still records what it did", () => {
  it("timestamps and audits, which is exactly why `sent` must not reach it", () => {
    // Not a bug — this is correct for delivered/canceled/queued. It is the
    // reason a mis-stamped `sent` would have been indistinguishable from a real
    // one afterwards.
    expect(PERSISTENCE).toContain('if (to === "sent" || to === "delivered") patch.dispatched_at');
    expect(PERSISTENCE).toContain("campaign_events");
  });
});
