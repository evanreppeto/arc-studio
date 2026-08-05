import { describe, expect, it } from "vitest";

import {
  dispatchStatusForResendEvent,
  engagementForResendEvent,
  parseResendWebhookEvent,
  type ResendWebhookEvent,
} from "../resend-webhook";

function event(type: string, extra: Record<string, unknown> = {}): unknown {
  return { type, created_at: "2026-07-23T12:00:00.000Z", data: { email_id: "re_msg_1", ...extra } };
}

describe("parseResendWebhookEvent", () => {
  it("parses a handled event with its message id and timestamp", () => {
    expect(parseResendWebhookEvent(event("email.opened"))).toEqual({
      type: "email.opened",
      emailId: "re_msg_1",
      createdAt: "2026-07-23T12:00:00.000Z",
      clickedLink: null,
      recipient: null,
      bounceType: null,
    });
  });

  it("captures the clicked link on email.clicked", () => {
    const parsed = parseResendWebhookEvent(event("email.clicked", { click: { link: "https://example.com/offer" } }));
    expect(parsed?.clickedLink).toBe("https://example.com/offer");
  });

  it("returns null for unknown types, missing ids, and junk", () => {
    expect(parseResendWebhookEvent(event("email.unknown_thing"))).toBeNull();
    expect(parseResendWebhookEvent({ type: "email.opened", data: {} })).toBeNull();
    expect(parseResendWebhookEvent({ type: "email.opened" })).toBeNull();
    expect(parseResendWebhookEvent(null)).toBeNull();
    expect(parseResendWebhookEvent("email.opened")).toBeNull();
  });
});

describe("engagementForResendEvent", () => {
  const base: Omit<ResendWebhookEvent, "type"> = { emailId: "re_msg_1", createdAt: null, clickedLink: null, recipient: null, bounceType: null };

  it("maps opens and clicks to inbound journey-visible event types", () => {
    expect(engagementForResendEvent({ ...base, type: "email.opened" })).toMatchObject({ eventType: "email_open", direction: "inbound" });
    expect(engagementForResendEvent({ ...base, type: "email.clicked", clickedLink: "https://x.co" })).toMatchObject({
      eventType: "email_click",
      direction: "inbound",
      summary: "Recipient clicked https://x.co",
    });
  });

  it("maps delivery outcomes as outbound facts", () => {
    expect(engagementForResendEvent({ ...base, type: "email.delivered" })?.eventType).toBe("email_delivered");
    expect(engagementForResendEvent({ ...base, type: "email.bounced" })?.eventType).toBe("email_bounced");
  });

  it("skips email.sent (the app already records outbound_send) and delivery_delayed", () => {
    expect(engagementForResendEvent({ ...base, type: "email.sent" })).toBeNull();
    expect(engagementForResendEvent({ ...base, type: "email.delivery_delayed" })).toBeNull();
  });
});

describe("dispatchStatusForResendEvent", () => {
  it("advances delivered and bounced only", () => {
    expect(dispatchStatusForResendEvent("email.delivered")).toBe("delivered");
    expect(dispatchStatusForResendEvent("email.bounced")).toBe("failed");
    expect(dispatchStatusForResendEvent("email.opened")).toBeNull();
    expect(dispatchStatusForResendEvent("email.clicked")).toBeNull();
    expect(dispatchStatusForResendEvent("email.sent")).toBeNull();
  });
});
