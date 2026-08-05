import { describe, expect, it } from "vitest";

import {
  isPermanentBounce,
  normalizeEmailAddress,
  describeEmailSuppressionReason,
  isEmailSuppressionReason,
  labelEmailSuppressionReason,
} from "../email-suppression";
import { parseResendWebhookEvent, suppressionForResendEvent, type ResendWebhookEvent } from "../resend-webhook";

describe("normalizeEmailAddress", () => {
  it("lowercases and trims so a case difference can't slip past the register", () => {
    // The whole failure mode: the resolver emits one casing, the register holds
    // another, and the membership test misses.
    expect(normalizeEmailAddress("  Sam@Example.COM ")).toBe("sam@example.com");
    expect(normalizeEmailAddress(null)).toBe("");
    expect(normalizeEmailAddress(undefined)).toBe("");
  });

  it("does NOT canonicalize plus-tags or dots — those are different mailboxes", () => {
    // Over-normalizing would suppress people who never opted out.
    expect(normalizeEmailAddress("sam+news@example.com")).toBe("sam+news@example.com");
    expect(normalizeEmailAddress("s.a.m@example.com")).toBe("s.a.m@example.com");
  });
});

describe("isPermanentBounce", () => {
  it("treats only a permanent bounce as suppressible", () => {
    expect(isPermanentBounce("Permanent")).toBe(true);
    expect(isPermanentBounce("permanent")).toBe(true);
  });

  it("leaves transient and undetermined bounces alone", () => {
    // A full mailbox or a greylisting rollout must not permanently drop a
    // reachable customer.
    expect(isPermanentBounce("Transient")).toBe(false);
    expect(isPermanentBounce("Undetermined")).toBe(false);
    expect(isPermanentBounce(null)).toBe(false);
    expect(isPermanentBounce("")).toBe(false);
  });
});

describe("reason vocabulary", () => {
  it("describes and labels every reason", () => {
    for (const reason of ["unsubscribe", "bounce", "complaint", "manual"] as const) {
      expect(describeEmailSuppressionReason(reason).length).toBeGreaterThan(0);
      expect(labelEmailSuppressionReason(reason).length).toBeGreaterThan(0);
      expect(isEmailSuppressionReason(reason)).toBe(true);
    }
    expect(isEmailSuppressionReason("something_else")).toBe(false);
  });
});

describe("suppressionForResendEvent", () => {
  const base: Omit<ResendWebhookEvent, "type"> = {
    emailId: "re_1",
    createdAt: null,
    clickedLink: null,
    recipient: "sam@example.com",
    bounceType: null,
  };

  it("suppresses on a spam complaint", () => {
    // This changed NOTHING before BSR-482: a complaint recorded an engagement
    // row and the same address was mailed again by the next campaign.
    expect(suppressionForResendEvent({ ...base, type: "email.complained" })).toMatchObject({ reason: "complaint" });
  });

  it("suppresses on a permanent bounce only", () => {
    expect(suppressionForResendEvent({ ...base, type: "email.bounced", bounceType: "Permanent" })).toMatchObject({
      reason: "bounce",
    });
    expect(suppressionForResendEvent({ ...base, type: "email.bounced", bounceType: "Transient" })).toBeNull();
    expect(suppressionForResendEvent({ ...base, type: "email.bounced", bounceType: null })).toBeNull();
  });

  it("never suppresses on engagement or delivery", () => {
    for (const type of ["email.opened", "email.clicked", "email.delivered", "email.sent"] as const) {
      expect(suppressionForResendEvent({ ...base, type })).toBeNull();
    }
  });
});

describe("parseResendWebhookEvent — suppression fields", () => {
  it("reads the recipient and the bounce classification", () => {
    const parsed = parseResendWebhookEvent({
      type: "email.bounced",
      created_at: "2026-08-05T00:00:00.000Z",
      data: { email_id: "re_1", to: ["sam@example.com"], bounce: { type: "Permanent" } },
    });
    expect(parsed).toMatchObject({ recipient: "sam@example.com", bounceType: "Permanent" });
  });

  it("accepts a bare string recipient as well as an array", () => {
    const parsed = parseResendWebhookEvent({
      type: "email.complained",
      created_at: null,
      data: { email_id: "re_2", to: "sam@example.com" },
    });
    expect(parsed?.recipient).toBe("sam@example.com");
  });
});
