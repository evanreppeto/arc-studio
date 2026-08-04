import { describe, expect, it } from "vitest";

import { findIdentifierLeak } from "../identifier-leak";
import {
  approvalDecisionActivityLabel,
  approvalDecisionActivityPredicate,
  campaignEventActivityLabel,
  campaignEventActivityPredicate,
  runActivityLabel,
  runActivityPredicate,
} from "../vocabulary";

/**
 * BSR-734. Home renders `<b>{actor}</b> {text}` and was handed the entry's
 * TITLE, so the front page read "You Approval Revision Requested" four times in
 * a row — a stored enum, Title-Cased, templated into a sentence it does not fit.
 *
 * Both halves were wrong, and they need opposite fixes: the Title Case is what
 * makes it look like a database value, and the noun phrase is what makes it
 * ungrammatical after an actor. Hence two shapes.
 */

const PREDICATES = [
  approvalDecisionActivityPredicate,
  runActivityPredicate,
  campaignEventActivityPredicate,
];
const LABELS = [approvalDecisionActivityLabel, runActivityLabel, campaignEventActivityLabel];

/** Every value these columns actually hold in prod, censused 2026-08-04. */
const PROD_VALUES = {
  decision: ["revision_requested", "approved", "archived", "declined"],
  run: ["completed", "canceled"],
  campaignEvent: [
    "asset_generated",
    "approval_decided",
    "created",
    "approval_submitted",
    "dispatch_canceled",
    "dispatch_queued",
    "dispatch_sent",
    "dispatch_failed",
    "archived",
    "campaign_launched",
  ],
};

describe("the line Home actually renders", () => {
  it("reads as a sentence for the decision that dominates the live feed", () => {
    expect(`You ${approvalDecisionActivityPredicate("revision_requested")}`).toBe("You asked for changes");
    expect(`You ${approvalDecisionActivityPredicate("approved")}`).toBe("You approved a draft");
    expect(`Arc ${runActivityPredicate("canceled")}`).toBe("Arc canceled a run");
  });

  it("never starts a predicate with a capital — it continues a sentence", () => {
    for (const [column, values] of Object.entries(PROD_VALUES)) {
      const fn = { decision: approvalDecisionActivityPredicate, run: runActivityPredicate, campaignEvent: campaignEventActivityPredicate }[column]!;
      for (const value of values) {
        const out = fn(value);
        expect(out[0], `${column}/${value} → ${out}`).toBe(out[0]!.toLowerCase());
      }
    }
  });
});

describe("labels stay noun phrases for a list heading", () => {
  it("titles the decision without the enum's Title Case", () => {
    expect(approvalDecisionActivityLabel("revision_requested")).toBe("Changes requested");
    expect(runActivityLabel("completed")).toBe("Run finished");
    expect(campaignEventActivityLabel("asset_generated")).toBe("Draft created");
  });
});

describe("totality — reality adds values on its own schedule", () => {
  const UNMAPPED = ["some_new_state", "SCREAMING", "camelCaseArrival", "plain", ""];

  it("answers for every prod value and every value nobody predicted", () => {
    for (const fn of [...PREDICATES, ...LABELS]) {
      for (const value of [...Object.values(PROD_VALUES).flat(), ...UNMAPPED, null, undefined]) {
        const out = fn(value as string);
        expect(out, `${fn.name}(${String(value)})`).toBeTruthy();
        // The property that matters: never the stored value, always language.
        expect(findIdentifierLeak(out), `${fn.name}(${String(value)}) → ${out}`).toBeNull();
      }
    }
  });

  it("keeps an unknown value grammatical after an actor", () => {
    // The fallback must not reintroduce the bug in a new costume: "You some new
    // state" is exactly as broken as "You Approval Revision Requested".
    expect(`You ${approvalDecisionActivityPredicate("some_new_state")}`).toBe("You recorded some new state");
    expect(`Arc ${campaignEventActivityPredicate("brand_new_event")}`).toBe("Arc recorded brand new event");
  });
});
