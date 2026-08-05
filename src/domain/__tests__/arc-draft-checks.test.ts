import { describe, expect, it } from "vitest";

import { arcDraftCheckState, type ArcActionFlag } from "@/domain";

const flag = (tone: ArcActionFlag["tone"], label: string = tone): ArcActionFlag => ({ tone, label });

describe("arcDraftCheckState", () => {
  /**
   * The distinction this exists for. Both of these render as "no warn/risk
   * flags", and treating them alike is what makes an unreviewed draft look
   * approvable — on prod, 13 of 16 draft cards are the second case.
   */
  it("separates a recorded pass from no record at all", () => {
    expect(arcDraftCheckState([flag("ok", "Brand voice")])).toBe("clean");
    expect(arcDraftCheckState([])).toBe("unchecked");
    expect(arcDraftCheckState(undefined)).toBe("unchecked");
  });

  it("reports a flagged draft when anything warns or risks", () => {
    expect(arcDraftCheckState([flag("warn")])).toBe("flagged");
    expect(arcDraftCheckState([flag("risk")])).toBe("flagged");
    // A single warn outranks any number of passes — the reviewer needs the worst news.
    expect(arcDraftCheckState([flag("ok"), flag("ok"), flag("warn")])).toBe("flagged");
  });

  it("never reports unchecked as clean", () => {
    // Guards the specific regression: an absence of evidence must not render as
    // evidence of absence on the approval screen.
    expect(arcDraftCheckState([])).not.toBe("clean");
  });
});
