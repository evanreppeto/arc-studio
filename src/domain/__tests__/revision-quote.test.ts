import { describe, expect, it } from "vitest";

import { MAX_REVISION_INSTRUCTION_LENGTH, validateRevisionInstruction } from "../campaign-revisions";
import { composeRevisionInstruction, MAX_QUOTE_LENGTH, normalizeQuote, truncateQuote } from "../revision-quote";

describe("normalizeQuote", () => {
  it("collapses the whitespace a selection drags in", () => {
    expect(normalizeQuote("  We answer\n\n  within   the hour  ")).toBe("We answer within the hour");
  });
});

describe("truncateQuote", () => {
  it("leaves a short selection alone", () => {
    expect(truncateQuote("Call us today")).toBe("Call us today");
  });

  /**
   * From the middle, not the tail: the end of a passage is often the part that
   * is wrong, so cutting it loses the reason the reviewer selected it.
   */
  it("elides the middle so both ends survive", () => {
    const long = `START ${"x".repeat(400)} END`;
    const out = truncateQuote(long);
    expect(out.length).toBeLessThanOrEqual(MAX_QUOTE_LENGTH);
    expect(out.startsWith("START")).toBe(true);
    expect(out.endsWith("END")).toBe(true);
    expect(out).toContain("…");
  });

  it("respects a smaller budget", () => {
    expect(truncateQuote("a".repeat(100), 20).length).toBeLessThanOrEqual(20);
  });
});

describe("composeRevisionInstruction", () => {
  /**
   * A revision requested without selecting anything must reach Arc byte for
   * byte as it did before this feature existed.
   */
  it("is exactly the operator's words when nothing is quoted", () => {
    expect(composeRevisionInstruction({ instruction: "Make it warmer" })).toBe("Make it warmer");
    expect(composeRevisionInstruction({ quote: "", instruction: "Make it warmer" })).toBe("Make it warmer");
    expect(composeRevisionInstruction({ quote: "   ", instruction: "Make it warmer" })).toBe("Make it warmer");
  });

  it("names the passage when there is one", () => {
    expect(
      composeRevisionInstruction({ quote: "We answer within the hour", instruction: "Too absolute — soften it." }),
    ).toBe('About this part: "We answer within the hour"\n\nToo absolute — soften it.');
  });

  /**
   * The operator's own words are the point. If the two together would breach
   * the limit the server validates against, the quote yields, never the
   * instruction.
   */
  it("keeps the whole instruction and shrinks the quote under pressure", () => {
    const instruction = "y".repeat(MAX_REVISION_INSTRUCTION_LENGTH - 60);
    const out = composeRevisionInstruction({ quote: "z".repeat(2000), instruction });
    expect(out.length).toBeLessThanOrEqual(MAX_REVISION_INSTRUCTION_LENGTH);
    expect(out).toContain(instruction);
  });

  it("drops the quote entirely rather than truncate the instruction", () => {
    const instruction = "y".repeat(MAX_REVISION_INSTRUCTION_LENGTH);
    const out = composeRevisionInstruction({ quote: "a quoted line", instruction });
    expect(out).toBe(instruction);
  });

  /** Whatever it produces has to survive the validator the action runs. */
  it("always produces something the server accepts", () => {
    const cases = [
      { quote: "short", instruction: "fix it" },
      { quote: "q".repeat(5000), instruction: "fix it" },
      { quote: "line\nwith\nnewlines", instruction: "fix it" },
      { quote: 'has "quotes" inside', instruction: "fix it" },
    ];
    for (const c of cases) {
      const composed = composeRevisionInstruction(c);
      expect(() => validateRevisionInstruction(composed), JSON.stringify(c)).not.toThrow();
    }
  });
});
