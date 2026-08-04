import { describe, expect, it } from "vitest";

import { findIdentifierLeak } from "../identifier-leak";
import {
  assetSourceLabel,
  reviewAgentLabel,
  reviewVerdictLabel,
  riskFlagLabel,
} from "../vocabulary";

/**
 * BSR-742. Four stored columns reached the campaign screen verbatim:
 *
 *   Sms · arc_saved · updated Aug 3
 *   draft-critic recommends  request revision
 *   [ unsupported_claim ]
 *
 * Values below are the live ones, censused from prod on 2026-08-04.
 */

const PROD = {
  toolSource: ["arc_saved", "creative_generator", "Arc Orchestrator", "Arc Demo Orchestrator"],
  agent: ["draft-critic"],
  verdict: ["request revision", "approve"],
  riskFlag: ["unsupported_claim", "claim_risk"],
};

describe("the lines the campaign screen actually renders", () => {
  it("names where a deliverable came from", () => {
    expect(assetSourceLabel("arc_saved")).toBe("Saved from a chat");
    expect(assetSourceLabel("creative_generator")).toBe("Generated creative");
  });

  it("leaves prose a writer already wrote alone", () => {
    // tool_source holds BOTH shapes. An exhaustive lookup would have printed
    // nothing here; a blind humanizer would have mangled it to "Arc orchestrator".
    expect(assetSourceLabel("Arc Orchestrator")).toBe("Arc Orchestrator");
    expect(assetSourceLabel("Arc Demo Orchestrator")).toBe("Arc Demo Orchestrator");
  });

  it("omits the segment entirely when there is no source", () => {
    // The meta line reads "Sms · updated Aug 3", not "Sms · — · updated Aug 3".
    for (const absent of [null, undefined, "", "   "]) {
      expect(assetSourceLabel(absent), JSON.stringify(absent)).toBeNull();
    }
  });

  it("reads as a sentence in the critic block", () => {
    expect(`${reviewAgentLabel("draft-critic")} recommends ${reviewVerdictLabel("request revision")}`).toBe(
      "Arc's claims reviewer recommends changes",
    );
    expect(`${reviewAgentLabel("draft-critic")} recommends ${reviewVerdictLabel("approve")}`).toBe(
      "Arc's claims reviewer recommends approval",
    );
  });

  it("keeps Arc's own note distinguishable from the independent review", () => {
    // recommend_on_approval writes as `arc`; that must not read as an
    // independent check of Arc's own work.
    expect(reviewAgentLabel("arc")).toBe("Arc");
    expect(reviewAgentLabel("draft-critic")).not.toBe(reviewAgentLabel("arc"));
  });

  it("says what a risk flag means, not what the column stores", () => {
    expect(riskFlagLabel("unsupported_claim")).toBe("Claim we cannot back up");
    expect(riskFlagLabel("claim_risk")).toBe("Risky claim");
  });
});

describe("totality", () => {
  const MAPPERS = [reviewAgentLabel, reviewVerdictLabel, riskFlagLabel];
  const UNMAPPED = ["some_new_flag", "SCREAMING", "camelCaseArrival", "plain"];

  it("answers with language for every prod value and every unpredicted one", () => {
    const all = [...Object.values(PROD).flat(), ...UNMAPPED, "", "   ", null, undefined];
    for (const fn of MAPPERS) {
      for (const value of all) {
        const out = fn(value as string);
        expect(out, `${fn.name}(${JSON.stringify(value)})`).toBeTruthy();
        expect(findIdentifierLeak(out), `${fn.name}(${JSON.stringify(value)}) → ${out}`).toBeNull();
      }
    }
  });

  it("never lets an unmapped source through as an identifier", () => {
    // assetSourceLabel is nullable, so it is checked separately — but when it
    // DOES answer, the answer may not be a stored value.
    for (const value of [...PROD.toolSource, ...UNMAPPED]) {
      const out = assetSourceLabel(value);
      if (out) expect(findIdentifierLeak(out), `${value} → ${out}`).toBeNull();
    }
  });
});
