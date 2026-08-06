import { describe, expect, it } from "vitest";

import { toWorkState, WORK_STATE_MEANING } from "@/domain";

import { isWaitingOnOperator, OPERATOR_BLOCKED_APPROVAL_STATUSES } from "./read-model";

/**
 * BSR-753. The Campaigns nav badge read `summary.approvals.length` — a list
 * fetched with `limit: 5`. Two separate faults in one number:
 *
 *   1. A page size, not a total. It could never exceed 5 however much work was
 *      waiting. On the live workspace it read 5 beside 7 active approvals.
 *   2. It counted `revision_requested`, which the vocabulary defines as "You
 *      asked for changes. Arc is reworking it" — waiting on Arc, not on you.
 *      3 of those 7.
 *
 * The status list has to be literal, because the query filters on enum values.
 * This file is what stops it drifting from the vocabulary that defines what the
 * words mean.
 */

/** Every status the approvals read-model treats as still open. */
const ACTIVE = ["needs_compliance", "pending_approval", "pending_owner_approval", "revision_requested"];

describe("what counts as waiting on the operator", () => {
  it("agrees with the vocabulary on every status it claims", () => {
    for (const status of OPERATOR_BLOCKED_APPROVAL_STATUSES) {
      expect(toWorkState(status), `${status} must be a needs_you state`).toBe("needs_you");
    }
  });

  it("excludes the states the vocabulary says Arc owns", () => {
    // The meaning is the test: if this string ever changes to describe operator
    // work, this assertion is the thing that should stop the change landing
    // silently.
    expect(WORK_STATE_MEANING.needs_changes).toBe("You asked for changes. Arc is reworking it.");
    expect(isWaitingOnOperator("revision_requested")).toBe(false);
    expect(toWorkState("revision_requested")).toBe("needs_changes");
  });

  it("counts the two that are genuinely blocked on a human", () => {
    expect(isWaitingOnOperator("pending_approval")).toBe(true);
    expect(isWaitingOnOperator("pending_owner_approval")).toBe(true);
  });

  /**
   * `needs_compliance` counts (BSR-755). It read three ways across the codebase
   * — "Blocked by a rule", "work coming back to you", and `draft` — but the
   * state machine settles it rather than taste:
   *
   *   - the guardrail that sets it raises "Human review required"
   *   - Arc "may READ approvals and ADD a recommendation, but never decides"
   *   - nothing redrafts the item
   *
   * So it sits untouched until a person approves, revises or declines it. That
   * is what blocked-on-the-operator means, and `draft` — "Arc is still building
   * this" — was the one reading that could not be true.
   */
  it("counts a compliance hold, because nothing clears it but a person", () => {
    expect(isWaitingOnOperator("needs_compliance")).toBe(true);
    expect(toWorkState("needs_compliance")).toBe("needs_you");
  });

  it("does not let the compliance branch swallow a genuine block", () => {
    // `blocked` sits next to `compliance` in toWorkState's ordering, and the
    // compliance check runs first. It must not capture its neighbour.
    expect(toWorkState("blocked")).toBe("needs_changes");
    expect(isWaitingOnOperator("blocked")).toBe(false);
  });

  it("is total over every active status, and over nonsense", () => {
    for (const status of [...ACTIVE, "", "   ", "some_new_state", null, undefined]) {
      expect(typeof isWaitingOnOperator(status as string), String(status)).toBe("boolean");
    }
  });

  it("never claims more than the active set", () => {
    for (const status of OPERATOR_BLOCKED_APPROVAL_STATUSES) {
      expect(ACTIVE, `${status} must also be an active status`).toContain(status);
    }
  });
});
