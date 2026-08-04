import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { UUID_PATTERN, UUID_SOURCE } from "../identifier-leak";

/**
 * BSR-750. Two modules defined "what a primary key looks like" on the same day,
 * hours apart, for the same purpose — keeping ids off the screen.
 * `identifier-leak.ts` exported its pattern specifically so it could be shared;
 * `opportunities/prose.ts` had already written its own and never saw it.
 *
 * Neither was wrong. Two of them can drift, and the whole point of the display
 * guard is that it agrees with the sanitizer about what it is guarding against.
 *
 * The shared thing is the SOURCE string, not a compiled regex: `replace` needs
 * `g` and `test` must not have it, because a global regex carries `lastIndex`
 * and answers differently on successive calls.
 */

const SRC = join(new URL("../../", import.meta.url).pathname);

/** Files that sanitise or detect identifiers for DISPLAY. Not input validation. */
const DISPLAY_MODULES = [
  "domain/identifier-leak.ts",
  "app/(app)/opportunities/prose.ts",
];

describe("the uuid shape has one definition", () => {
  it("is defined literally in exactly one place", () => {
    const written = DISPLAY_MODULES.filter((rel) => {
      const source = readFileSync(join(SRC, rel), "utf8");
      // The literal shape, spelled out — as opposed to referencing UUID_SOURCE.
      return /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/.test(source);
    });
    expect(written, "import UUID_SOURCE from @/domain instead of respelling it").toEqual([
      "domain/identifier-leak.ts",
    ]);
  });

  it("every other display module derives from the shared source", () => {
    for (const rel of DISPLAY_MODULES.filter((r) => r !== "domain/identifier-leak.ts")) {
      const source = readFileSync(join(SRC, rel), "utf8");
      expect(source, `${rel} must import the shape`).toMatch(/UUID_SOURCE|UUID_PATTERN/);
    }
  });

  it("exports the source as a string, so callers can pick their own flags", () => {
    expect(typeof UUID_SOURCE).toBe("string");
    // A shared COMPILED global would be the bug this shape exists to avoid.
    expect(UUID_PATTERN.global, "the exported pattern must not be global").toBe(false);
  });

  it("matches a real primary key and not a date or a colour", () => {
    expect(UUID_PATTERN.test("0bd41cb3-ff30-4548-92e6-4ba431b61c8d")).toBe(true);
    for (const notAnId of ["2026-08-04", "60613-1204", "#c8a24a", "high-intent"]) {
      expect(UUID_PATTERN.test(notAnId), notAnId).toBe(false);
    }
  });

  it("stays stateless across calls, which a global regex would not", () => {
    const id = "0bd41cb3-ff30-4548-92e6-4ba431b61c8d";
    expect(UUID_PATTERN.test(id)).toBe(true);
    expect(UUID_PATTERN.test(id)).toBe(true);
    expect(UUID_PATTERN.test(id)).toBe(true);
  });
});
