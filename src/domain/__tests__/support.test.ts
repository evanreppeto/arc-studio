import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SUPPORT_BODY_MAX,
  SUPPORT_CATEGORIES,
  SUPPORT_IMPACTS,
  SUPPORT_STATUSES,
  SUPPORT_SUBJECT_MAX,
  buildSupportMailto,
  formatSupportEmail,
  parseSupportRequest,
  supportCategoryLabel,
  supportReferenceCode,
  supportStatusMeta,
  type NormalizedSupportRequest,
} from "../support";

const valid = {
  category: "bug",
  impact: "blocking",
  subject: "Approve button does nothing",
  body: "I clicked Approve on the draft email and nothing happened.",
};

describe("parseSupportRequest", () => {
  it("accepts a complete request and normalizes whitespace", () => {
    const result = parseSupportRequest({ ...valid, subject: "  Approve button does nothing  " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.subject).toBe("Approve button does nothing");
    expect(result.value.category).toBe("bug");
    expect(result.value.impact).toBe("blocking");
  });

  it("rejects an unknown category or impact rather than defaulting", () => {
    // Silently coercing would write a value the DB CHECK constraint rejects.
    expect(parseSupportRequest({ ...valid, category: "urgent" }).ok).toBe(false);
    expect(parseSupportRequest({ ...valid, impact: "catastrophic" }).ok).toBe(false);
  });

  it("requires a summary and enough detail to act on", () => {
    expect(parseSupportRequest({ ...valid, subject: "   " }).ok).toBe(false);
    expect(parseSupportRequest({ ...valid, body: "broken" }).ok).toBe(false);
  });

  it("caps subject and body at the documented limits", () => {
    const result = parseSupportRequest({
      ...valid,
      subject: "s".repeat(SUPPORT_SUBJECT_MAX + 50),
      body: "b".repeat(SUPPORT_BODY_MAX + 500),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.subject).toHaveLength(SUPPORT_SUBJECT_MAX);
    expect(result.value.body).toHaveLength(SUPPORT_BODY_MAX);
  });

  it("keeps only in-app page paths, never an absolute URL", () => {
    const external = parseSupportRequest({
      ...valid,
      diagnostics: { pagePath: "https://evil.example.com/steal" },
    });
    expect(external.ok).toBe(true);
    if (!external.ok) return;
    expect(external.value.pagePath).toBe("");

    const internal = parseSupportRequest({ ...valid, diagnostics: { pagePath: "/campaigns/abc" } });
    expect(internal.ok).toBe(true);
    if (!internal.ok) return;
    expect(internal.value.pagePath).toBe("/campaigns/abc");
  });

  it("drops unknown diagnostic keys and truncates long ones", () => {
    const result = parseSupportRequest({
      ...valid,
      diagnostics: { userAgent: "u".repeat(900), timezone: "America/Chicago" } as never,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics.userAgent).toHaveLength(400);
    expect(result.value.diagnostics.timezone).toBe("America/Chicago");
    expect(Object.keys(result.value.diagnostics).sort()).toEqual(["timezone", "userAgent"]);
  });
});

describe("supportReferenceCode", () => {
  it("derives a stable short code from the row id", () => {
    const id = "6f9619ff-8b86-d011-b42d-00c04fc964ff";
    expect(supportReferenceCode(id)).toBe("ARC-6F9619");
    expect(supportReferenceCode(id)).toBe(supportReferenceCode(id));
  });
});

describe("formatSupportEmail", () => {
  const request: NormalizedSupportRequest = {
    category: "bug",
    impact: "blocking",
    subject: "Approve button does nothing",
    body: "Clicked Approve, nothing happened.",
    pagePath: "/campaigns",
    diagnostics: { pagePath: "/campaigns", appVersion: "abc1234" },
  };

  it("tags the subject with the reference so replies can be matched back", () => {
    const email = formatSupportEmail({
      reference: "ARC-6F9619",
      request,
      workspaceName: "Acme",
      orgId: "org-1",
      submittedByEmail: "dana@acme.test",
      submittedByName: "Dana",
    });
    expect(email.subject).toContain("ARC-6F9619");
    expect(email.subject).toContain("Approve button does nothing");
    expect(email.bodyBlocks[0]).toBe(request.body);
    expect(email.bodyBlocks[1]).toContain("Workspace: Acme");
    expect(email.bodyBlocks[1]).toContain("dana@acme.test");
    expect(email.bodyBlocks[1]).toContain("Build: abc1234");
  });

  it("stays sendable when the submitter has no name or email on file", () => {
    const email = formatSupportEmail({
      reference: "ARC-000001",
      request,
      workspaceName: "Acme",
      orgId: "org-1",
      submittedByEmail: "",
      submittedByName: "",
    });
    expect(email.bodyBlocks.join("\n")).toContain("no email on file");
  });
});

describe("buildSupportMailto", () => {
  it("pre-fills the fallback path without depending on Supabase or Resend", () => {
    const href = buildSupportMailto({
      inbox: "support@example.com",
      workspaceName: "Acme",
      submittedByEmail: "dana@acme.test",
      pagePath: "/outbox",
      appVersion: "abc1234",
    });
    expect(href.startsWith("mailto:support@example.com?")).toBe(true);
    const body = decodeURIComponent(new URL(href).searchParams.get("body") ?? "");
    expect(body).toContain("Workspace: Acme");
    expect(body).toContain("Page: /outbox");
    expect(body).toContain("Build: abc1234");
  });
});

describe("labels", () => {
  it("has a label for every category, impact, and status", () => {
    expect(SUPPORT_CATEGORIES.every((c) => c.label && c.hint)).toBe(true);
    expect(SUPPORT_IMPACTS.every((i) => i.label && i.hint)).toBe(true);
    expect(SUPPORT_STATUSES.every((s) => s.label && s.tone)).toBe(true);
  });

  it("falls back rather than throwing on an unknown key", () => {
    expect(supportCategoryLabel("nope")).toBe("Support request");
    expect(supportStatusMeta("nope").label).toBe("Open");
  });
});

// The recurring failure mode here is a value that passes validation and then
// trips a CHECK constraint at insert time — invisible to every mocked test. Pin
// the two together by reading the migration.
describe("migration parity", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20260727120000_support_requests.sql"),
    "utf8",
  );

  it("allows exactly the categories, impacts, and statuses the domain defines", () => {
    for (const { key } of SUPPORT_CATEGORIES) expect(sql).toContain(`'${key}'`);
    for (const { key } of SUPPORT_IMPACTS) expect(sql).toContain(`'${key}'`);
    for (const { key } of SUPPORT_STATUSES) expect(sql).toContain(`'${key}'`);

    const categoryCheck = /category in \(([^)]*)\)/.exec(sql)?.[1] ?? "";
    expect(categoryCheck.split(",").length).toBe(SUPPORT_CATEGORIES.length);
    const impactCheck = /impact in \(([^)]*)\)/.exec(sql)?.[1] ?? "";
    expect(impactCheck.split(",").length).toBe(SUPPORT_IMPACTS.length);
    const statusCheck = /status in \(([^)]*)\)/.exec(sql)?.[1] ?? "";
    expect(statusCheck.split(",").length).toBe(SUPPORT_STATUSES.length);
  });
});
