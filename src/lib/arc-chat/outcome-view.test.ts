import { describe, expect, it } from "vitest";

import { buildArcOutcomeView } from "./outcome-view";

describe("buildArcOutcomeView", () => {
  it("returns the response verbatim, headings and all", () => {
    const view = buildArcOutcomeView({
      request: "Analyze the strongest opportunity",
      response: "## Rebuild homeowners are the best opportunity\n\nThe CRM contains 21 leads.",
      mode: "ask",
      sourceCount: 3,
    });

    expect(view).toMatchObject({
      intent: "analysis",
      body: "## Rebuild homeowners are the best opportunity\n\nThe CRM contains 21 leads.",
      safetyLabel: "Read only",
      badges: [{ kind: "sources", label: "3 sources" }],
    });
  });

  // The regression this guards: the old heading extraction matched the first
  // heading ANYWHERE in the reply (a multiline, unanchored regex) and then
  // deleted it in place. A reply that opened with prose and later had a
  // "## Recommended next steps" section had that heading hoisted to the top —
  // above prose it did not describe — and stripped from its own section, so the
  // list below read as an unlabeled continuation of the preceding paragraph.
  it("leaves a mid-document heading where Arc put it", () => {
    const response = "Three accounts stand out this week.\n\n## Recommended next steps\n\n- Call Dana first";
    const view = buildArcOutcomeView({ request: "What should I do?", response, mode: "ask" });

    expect(view.body).toBe(response);
  });

  it("adds only evidence badges supported by the response", () => {
    const view = buildArcOutcomeView({
      request: "Draft the email",
      response: "The draft is ready. One limitation: audience recency is unknown.",
      mode: "draft",
      recallCount: 2,
      actions: [{ kind: "draft", title: "Email", rows: [], flags: [], status: "draft" }],
    });

    expect(view.badges.map((badge) => badge.kind)).toEqual(["memory", "created", "limitation"]);
    expect(view.safetyLabel).toBe("Nothing sent");
  });

  it("treats recommendations in action-capable mode as analysis without implying a change", () => {
    const view = buildArcOutcomeView({
      request: "Compare our last three campaigns and recommend the next move.",
      response: "The retention campaign is the strongest next move.",
      mode: "act",
    });

    expect(view).toMatchObject({
      intent: "analysis",
      label: "Recommendation",
      safetyLabel: "No changes recorded",
    });
  });

  it("does not claim an explicit action completed when no workspace effect was recorded", () => {
    const view = buildArcOutcomeView({
      request: "Update the campaign owner",
      response: "I attempted to update the campaign owner.",
      mode: "act",
      actions: [{ kind: "result", title: "Campaign", rows: [], flags: [] }],
    });

    expect(view).toMatchObject({
      intent: "action",
      label: "No change recorded",
      body: "I attempted to update the campaign owner.",
      safetyLabel: "No changes recorded",
    });
    expect(view.badges).toEqual([]);
  });

  it("claims creation only when a reviewable draft is present", () => {
    const view = buildArcOutcomeView({
      request: "Update the campaign with a new email draft",
      response: "The email is ready for review.",
      mode: "act",
      actions: [{ kind: "draft", title: "Email", rows: [], flags: [], status: "draft" }],
    });

    expect(view).toMatchObject({
      intent: "action",
      label: "Created",
      safetyLabel: "Nothing sent",
      badges: [{ kind: "created", label: "1 deliverable" }],
    });
  });
});
