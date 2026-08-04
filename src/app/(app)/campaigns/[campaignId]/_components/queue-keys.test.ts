import { describe, expect, it } from "vitest";

import { isTypingTarget, keyToQueueAction, stepQueueIndex } from "./queue-keys";

const idle = { typing: false, modifier: false };

describe("keyToQueueAction", () => {
  it("maps the decision keys the footer advertises", () => {
    expect(keyToQueueAction("a", idle)).toBe("approve");
    expect(keyToQueueAction("d", idle)).toBe("decline");
    expect(keyToQueueAction("r", idle)).toBe("revise");
    expect(keyToQueueAction("e", idle)).toBe("edit");
  });

  it("moves on the vim keys and the arrows alike", () => {
    expect(keyToQueueAction("j", idle)).toBe("next");
    expect(keyToQueueAction("ArrowRight", idle)).toBe("next");
    expect(keyToQueueAction("k", idle)).toBe("prev");
    expect(keyToQueueAction("ArrowUp", idle)).toBe("prev");
  });

  it("takes a shortcut whatever the caps lock is doing", () => {
    expect(keyToQueueAction("A", idle)).toBe("approve");
  });

  it("declines nothing while someone is typing the letter d", () => {
    // The failure this exists to stop: writing "don't ship this" into the
    // revision box and having the first keystroke decline the deliverable.
    for (const key of ["a", "d", "r", "e", "j", "k", "ArrowRight"]) {
      expect(keyToQueueAction(key, { typing: true, modifier: false })).toBeNull();
    }
  });

  it("still lets Escape out of a text field", () => {
    expect(keyToQueueAction("Escape", { typing: true, modifier: false })).toBe("close");
  });

  it("keeps its hands off the browser's own shortcuts", () => {
    // ⌘R is reload and ⌘D is bookmark. Neither may reach the queue.
    expect(keyToQueueAction("r", { typing: false, modifier: true })).toBeNull();
    expect(keyToQueueAction("d", { typing: false, modifier: true })).toBeNull();
  });

  it("ignores a key it has no meaning for", () => {
    expect(keyToQueueAction("z", idle)).toBeNull();
    expect(keyToQueueAction("Enter", idle)).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("recognises the fields a reviewer types into", () => {
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("does not mistake the page itself for a text field", () => {
    expect(isTypingTarget({ tagName: "BODY" })).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("stepQueueIndex", () => {
  it("walks forward and back", () => {
    expect(stepQueueIndex(0, "next", 3)).toBe(1);
    expect(stepQueueIndex(2, "prev", 3)).toBe(1);
  });

  it("stops at both ends rather than wrapping", () => {
    // Reaching the end of the queue is information. Looping silently back to
    // the first deliverable would read as "nothing happened".
    expect(stepQueueIndex(2, "next", 3)).toBe(2);
    expect(stepQueueIndex(0, "prev", 3)).toBe(0);
  });

  it("survives an empty queue", () => {
    expect(stepQueueIndex(0, "next", 0)).toBe(0);
  });
});
