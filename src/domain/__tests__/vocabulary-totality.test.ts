import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { findIdentifierLeak } from "../identifier-leak";
import { STORED_VALUE_LABELLERS } from "../vocabulary";

/**
 * BSR-709, option B. Every mapper that turns a stored value into a user-facing
 * string must be TOTAL: for any input at all it returns language, never the
 * stored value and never nothing.
 *
 * This is the property that was missing each time a raw identifier reached the
 * screen. An exhaustive lookup is not a mapping — it is a mapping plus a silent
 * hole, and reality fills the hole on its own schedule: `route` is typed
 * `"fast" | "standard"` and already carries `"chat"`; `ArcRecall.kind` is typed
 * `string` and prod holds twelve values.
 */

/** Values nobody wrote a case for. The point is that none of these are special. */
const UNMAPPED = [
  "some_new_value",
  "brand_fact",
  "a_value_shipped_next_quarter",
  "mcp__arc__unheard_of_tool",
  "SCREAMING_NEW_STATE",
  "camelCaseArrival",
  "plain",
];

/** Inputs that are not values at all. */
const ABSENT = ["", "   ", null, undefined] as const;

describe("every registered labeller is total", () => {
  it("registers the mappers this file is meant to cover", () => {
    // A registry that quietly emptied would make every test below vacuous.
    expect(STORED_VALUE_LABELLERS.length).toBeGreaterThanOrEqual(6);
  });

  describe.each(STORED_VALUE_LABELLERS)("$name", (labeller) => {
    /**
     * Deliberately not asserting `out !== value`. `arcToolLabel("ToolSearch")`
     * returns its input unchanged and is right to — a camelCase name was written
     * by a person to be read. "Different from the input" is a proxy; "does not
     * read as a stored value" is the property, and the next test checks it.
     */
    it.each(UNMAPPED)("turns the unmapped %j into language", (value) => {
      const out = labeller.label(value);
      expect(out, "an unmapped value must still produce a label").toBeTruthy();
    });

    /**
     * The composition that makes this worth having: a mapper's OUTPUT is held to
     * the same standard the dev DOM check applies to rendered text. If a label
     * would trip that check, shipping it just moves the leak one layer up.
     */
    it.each(UNMAPPED)("never emits something the DOM check would flag, for %j", (value) => {
      const out = labeller.label(value);
      expect(out && findIdentifierLeak(out), `"${out}" still reads as a stored value`).toBeFalsy();
    });

    it("handles an absent value without rendering a blank", () => {
      for (const value of ABSENT) {
        const out = labeller.label(value);
        if (labeller.nullable) {
          // Nullable mappers may return null so the surface can omit the field —
          // but never an empty string, which renders as an invisible gap.
          expect(out === null || (typeof out === "string" && out.trim().length > 0)).toBe(true);
        } else {
          expect(out?.trim()).toBeTruthy();
        }
      }
    });

    it("every explicit label in its map already reads as language", () => {
      for (const [key, label] of Object.entries(labeller.map)) {
        expect(label.trim(), `${labeller.name}.${key} is blank`).toBeTruthy();
        expect(findIdentifierLeak(label), `${labeller.name}.${key} = "${label}" reads as a stored value`).toBeNull();
      }
    });
  });
});

/**
 * The registry is only as good as its coverage, and the failure mode is someone
 * adding a seventh mapper and not registering it — at which point the guarantees
 * above silently stop applying to the newest, least-reviewed code.
 */
describe("no mapper escapes the registry", () => {
  const SOURCE = readFileSync(new URL("../vocabulary.ts", import.meta.url), "utf8");

  /**
   * Mappers that deliberately sit outside it, each with a reason. Not a
   * convenience list — anything added here needs to be genuinely not a
   * stored-value mapper.
   */
  const EXEMPT: Record<string, string> = {
    workStateLabel: "takes a WorkState, which is already a domain state, not a stored column value",
  };

  it("every exported *Label function is registered or explicitly exempt", () => {
    const exported = [...SOURCE.matchAll(/^export function (\w*Label)\(/gm)].map((m) => m[1]!);
    const registered = new Set(STORED_VALUE_LABELLERS.map((l) => l.name));

    const unaccounted = exported.filter((name) => !registered.has(name) && !(name in EXEMPT));
    expect(unaccounted, "add these to STORED_VALUE_LABELLERS, or to EXEMPT with a reason").toEqual([]);
  });

  it("finds the exports at all, so a regex that stops matching cannot pass silently", () => {
    const exported = [...SOURCE.matchAll(/^export function (\w*Label)\(/gm)];
    expect(exported.length).toBeGreaterThanOrEqual(6);
  });
});
