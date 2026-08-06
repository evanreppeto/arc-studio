import { describe, expect, it } from "vitest";

import {
  buildSupportLinearIssue,
  parseSupportRequest,
  SUPPORT_APP_LABEL,
  SUPPORT_FEEDBACK_LABEL,
  supportLinearLabelNames,
  supportLinearLabels,
  supportLinearPriority,
  type NormalizedSupportRequest,
  type SupportLinearContext,
} from "@/domain";

function request(overrides: Partial<NormalizedSupportRequest> = {}): NormalizedSupportRequest {
  const parsed = parseSupportRequest({
    category: "bug",
    impact: "blocking",
    subject: "Campaigns board shows zero packages",
    body: "I opened /campaigns and it says 0 packages, but we approved four yesterday.",
    diagnostics: { pagePath: "/campaigns", appVersion: "a1b2c3d", viewport: "1440x900" },
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return { ...parsed.value, ...overrides };
}

function context(overrides: Partial<SupportLinearContext> = {}): SupportLinearContext {
  return {
    reference: "ARC-A1B2C3",
    request: request(),
    workspaceName: "Summit Plumbing",
    orgId: "0000-org",
    submittedByEmail: "jane@summit.test",
    submittedByName: "Jane Doe",
    ...overrides,
  };
}

describe("supportLinearLabels", () => {
  it("always carries the feedback marker so in-app reports are filterable as one set", () => {
    for (const category of ["bug", "question", "feature", "billing", "other"] as const) {
      expect(supportLinearLabels(category)).toContain(SUPPORT_FEEDBACK_LABEL);
    }
  });

  it("always says which app the report came from — one Linear team holds two products", () => {
    for (const category of ["bug", "question", "feature", "billing", "other"] as const) {
      expect(supportLinearLabels(category)).toContain(SUPPORT_APP_LABEL);
    }
  });

  it("adds the type label for every category that has one", () => {
    expect(supportLinearLabels("bug")).toEqual([SUPPORT_FEEDBACK_LABEL, SUPPORT_APP_LABEL, "Bug"]);
    expect(supportLinearLabels("question")).toEqual([SUPPORT_FEEDBACK_LABEL, SUPPORT_APP_LABEL, "Question"]);
    expect(supportLinearLabels("feature")).toEqual([SUPPORT_FEEDBACK_LABEL, SUPPORT_APP_LABEL, "Feature"]);
    expect(supportLinearLabels("billing")).toEqual([SUPPORT_FEEDBACK_LABEL, SUPPORT_APP_LABEL, "Billing"]);
  });

  it("leaves 'other' with only the markers — a made-up Other label carries no triage signal", () => {
    expect(supportLinearLabels("other")).toEqual([SUPPORT_FEEDBACK_LABEL, SUPPORT_APP_LABEL]);
  });

  it("declares every name it can emit, so the id lookup can prefetch them all", () => {
    const declared = new Set(supportLinearLabelNames());
    for (const category of ["bug", "question", "feature", "billing", "other"] as const) {
      for (const label of supportLinearLabels(category)) expect(declared.has(label)).toBe(true);
    }
  });
});

describe("supportLinearPriority", () => {
  it("maps impact onto Linear's scale, urgent-first", () => {
    expect(supportLinearPriority("blocking")).toBe(1);
    expect(supportLinearPriority("slowing")).toBe(2);
    expect(supportLinearPriority("minor")).toBe(4);
  });
});

describe("buildSupportLinearIssue", () => {
  it("titles the issue with the operator's own summary", () => {
    expect(buildSupportLinearIssue(context()).title).toBe("Campaigns board shows zero packages");
  });

  it("leads with the report, then the context table", () => {
    const { description } = buildSupportLinearIssue(context());
    expect(description.indexOf("we approved four yesterday")).toBeLessThan(description.indexOf("| **Reference** |"));
  });

  it("includes the reference verbatim so a code quoted in email finds the ticket", () => {
    expect(buildSupportLinearIssue(context()).description).toContain("ARC-A1B2C3");
  });

  it("carries the diagnostics a triager needs", () => {
    const { description } = buildSupportLinearIssue(context());
    expect(description).toContain("Summit Plumbing");
    expect(description).toContain("jane@summit.test");
    expect(description).toContain("a1b2c3d");
    expect(description).toContain("1440x900");
    expect(description).toContain("0000-org");
  });

  it("deep-links the page when an app url is known, and stays a plain path when it isn't", () => {
    expect(buildSupportLinearIssue(context({ appUrl: "https://arc-studio.ai/" })).description)
      .toContain("[/campaigns](https://arc-studio.ai/campaigns)");
    expect(buildSupportLinearIssue(context()).description).toContain("`/campaigns`");
  });

  it("omits rows the submitter never volunteered rather than printing empty cells", () => {
    const bare = request({ pagePath: "", diagnostics: {} });
    const { description } = buildSupportLinearIssue(context({ request: bare }));
    expect(description).not.toContain("**Page**");
    expect(description).not.toContain("**Browser**");
    expect(description).toContain("**Reference**");
  });

  it("names the submitter even when only an email is on file", () => {
    const { description } = buildSupportLinearIssue(context({ submittedByName: "" }));
    expect(description).toContain("jane@summit.test");
    const anon = buildSupportLinearIssue(context({ submittedByName: "", submittedByEmail: "" }));
    expect(anon.description).toContain("no email on file");
  });

  it("carries the labels and priority for the request's own category and impact", () => {
    const draft = buildSupportLinearIssue(context({ request: request({ category: "feature", impact: "minor" }) }));
    expect(draft.labels).toEqual([SUPPORT_FEEDBACK_LABEL, SUPPORT_APP_LABEL, "Feature"]);
    expect(draft.priority).toBe(4);
  });
});
