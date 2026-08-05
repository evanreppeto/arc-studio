import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { describeBlockedSend, isMidComposition } from "./composer-guard";

const idle = { isSending: false, demoPending: false, uploading: false };

describe("isMidComposition", () => {
  it("stays quiet while the composer is still being filled in", () => {
    // Each of these has a picker or a disabled button on screen already.
    expect(isMidComposition("")).toBe(true);
    expect(isMidComposition("/dra")).toBe(true);
    expect(isMidComposition("/")).toBe(true);
    expect(isMidComposition("Draft something for @")).toBe(true);
  });

  it("lets a real message through", () => {
    expect(isMidComposition("Draft a pre-winter check email")).toBe(false);
    // A slash command WITH an argument is a message, not a half-typed command.
    expect(isMidComposition("/draft a pre-winter check email")).toBe(false);
    // An @ that is not trailing has already been resolved into a mention.
    expect(isMidComposition("Ask @Maya about the flood package")).toBe(false);
  });
});

describe("describeBlockedSend", () => {
  it("says nothing when nothing is blocking", () => {
    expect(describeBlockedSend(idle)).toBeNull();
  });

  it("names every invisible flag, because the operator cannot see any of them", () => {
    // The bug this exists for: a stuck `uploading` swallowed every send for a
    // day. No message, no error, no request — indistinguishable from a dead app.
    expect(describeBlockedSend({ ...idle, uploading: true })).toMatch(/attachment/i);
    expect(describeBlockedSend({ ...idle, isSending: true })).toMatch(/sending/i);
    expect(describeBlockedSend({ ...idle, demoPending: true })).toMatch(/replying/i);
  });

  it("never returns an empty string for a blocked send", () => {
    // An empty notice renders as a blank chip, which is the silent failure again
    // wearing a different hat.
    for (const flag of ["isSending", "demoPending", "uploading"] as const) {
      const message = describeBlockedSend({ ...idle, [flag]: true });
      expect(message, flag).toBeTruthy();
      expect((message ?? "").trim().length, flag).toBeGreaterThan(0);
    }
  });

  it("names the send in flight first, since it clears on its own", () => {
    expect(describeBlockedSend({ isSending: true, demoPending: true, uploading: true })).toMatch(/sending/i);
  });
});

describe("the composer's send path", () => {
  const source = readFileSync(join(process.cwd(), "src/app/(app)/arc/_components/arc-view.tsx"), "utf8");

  it("resets the upload flag in a finally", () => {
    // `uploading` gates submitDraft. Reset outside a finally means one rejected
    // upload disables sending for the life of the page, silently. This asserts
    // the shape rather than the behaviour because the alternative is rendering
    // the whole chat to observe a flag.
    //
    // Matching the SYNTAX, not the word: the first version of this assertion was
    // `toContain("finally")`, and it stayed green with the finally deleted —
    // because the word was sitting in the comment right above it. Exactly the
    // false negative overlay-portal.test.ts records for `OverlayPortal`.
    const uploadBlock = source.slice(source.indexOf("setUploading(true)"), source.indexOf("const submitDraft"));
    expect(uploadBlock, "setUploading(false) must run from a finally block").toMatch(/\}\s*finally\s*\{/);
    expect(uploadBlock.search(/\}\s*finally\s*\{/)).toBeLessThan(uploadBlock.indexOf("setUploading(false)"));
  });

  it("routes the guard through composer-guard rather than an inline condition", () => {
    // The inline version bundled three invisible flags into a bare `return`.
    expect(source).toContain("describeBlockedSend");
    expect(source).toContain("isMidComposition");
    expect(source, "a blocked send must set a notice, not just return").toMatch(
      /const blocked = describeBlockedSend\([\s\S]{0,120}setComposerNotice\(blocked\)/,
    );
  });
});
