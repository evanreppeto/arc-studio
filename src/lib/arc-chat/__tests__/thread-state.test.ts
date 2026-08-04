import { describe, expect, it } from "vitest";

import { hasRepliedToLastMessage } from "../thread-state";

const op = (body = "make me an ad") => ({ role: "operator", body, status: "sent" });
const arc = (body = "here you go", status = "complete") => ({ role: "arc", body, status });

/**
 * Guards the duplicated-answer bug: the Studio panel decided "has Arc replied?"
 * by comparing server `createdAt` against a timestamp the BROWSER stamped. With
 * any clock skew the comparison never matched, the panel never left the waiting
 * state, and the finished reply rendered twice — once from the thread and once
 * from the live streaming bubble.
 */
describe("hasRepliedToLastMessage", () => {
  it("sees a completed reply after the operator's message", () => {
    expect(hasRepliedToLastMessage([op(), arc()])).toBe(true);
  });

  it("is still waiting when the operator's message is last", () => {
    expect(hasRepliedToLastMessage([op(), arc(), op("and again")])).toBe(false);
  });

  it("ignores replies that came BEFORE the latest message", () => {
    // The earlier answer must not be mistaken for an answer to the new question.
    expect(hasRepliedToLastMessage([op("first"), arc("answer to first"), op("second")])).toBe(false);
  });

  it("does not count an empty or pending reply row as an answer", () => {
    expect(hasRepliedToLastMessage([op(), arc("", "complete")])).toBe(false);
    expect(hasRepliedToLastMessage([op(), arc("   ", "complete")])).toBe(false);
    expect(hasRepliedToLastMessage([op(), arc("partial…", "pending")])).toBe(false);
  });

  it("counts a failed reply — the turn is over, stop waiting on it", () => {
    expect(hasRepliedToLastMessage([op(), arc("Something went wrong.", "failed")])).toBe(true);
  });

  it("is false for an empty thread or one with no operator message", () => {
    expect(hasRepliedToLastMessage([])).toBe(false);
    expect(hasRepliedToLastMessage([arc()])).toBe(false);
  });

  it("does not depend on any clock", () => {
    // The whole point: no createdAt anywhere in the input type.
    expect(hasRepliedToLastMessage([op(), arc()])).toBe(true);
  });
});
