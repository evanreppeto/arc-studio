import { describe, expect, it } from "vitest";

import {
  buildListUnsubscribeHeaders,
  buildUnsubscribeToken,
  buildUnsubscribeUrl,
  checkSenderIdentity,
  verifyUnsubscribeToken,
  wrapMarketingEmail,
} from "../email-compliance";

const SECRET = "test-secret-value";
const CLAIMS = { contactId: "c-1", orgId: "o-1" };
const IDENTITY = {
  senderName: "Big Shoulders Restoration",
  postalAddress: "123 W Example St\nChicago, IL 60601",
};

describe("unsubscribe tokens", () => {
  it("verifies a token it issued", () => {
    const token = buildUnsubscribeToken(CLAIMS, SECRET);
    expect(verifyUnsubscribeToken(CLAIMS, token, SECRET)).toBe(true);
  });

  // The whole point of signing: an attacker who can guess contact ids still
  // can't unsubscribe them, which matters more once List-Unsubscribe makes the
  // endpoint one-click and automatable.
  it("rejects a token minted for a different contact or org", () => {
    const token = buildUnsubscribeToken(CLAIMS, SECRET);
    expect(verifyUnsubscribeToken({ contactId: "c-2", orgId: "o-1" }, token, SECRET)).toBe(false);
    expect(verifyUnsubscribeToken({ contactId: "c-1", orgId: "o-2" }, token, SECRET)).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const token = buildUnsubscribeToken(CLAIMS, SECRET);
    expect(verifyUnsubscribeToken(CLAIMS, token, "other-secret")).toBe(false);
  });

  it("rejects empty and malformed tokens without throwing", () => {
    expect(verifyUnsubscribeToken(CLAIMS, "", SECRET)).toBe(false);
    expect(verifyUnsubscribeToken(CLAIMS, "short", SECRET)).toBe(false);
    expect(verifyUnsubscribeToken(CLAIMS, buildUnsubscribeToken(CLAIMS, SECRET), "")).toBe(false);
  });

  it("builds a URL carrying contact, org and signature", () => {
    const url = new URL(buildUnsubscribeUrl("https://arc-studio.ai/", CLAIMS, SECRET));
    expect(url.pathname).toBe("/api/unsubscribe");
    expect(url.searchParams.get("c")).toBe("c-1");
    expect(url.searchParams.get("o")).toBe("o-1");
    expect(verifyUnsubscribeToken(CLAIMS, url.searchParams.get("t") ?? "", SECRET)).toBe(true);
  });
});

describe("sender identity gate", () => {
  it("accepts a complete identity", () => {
    expect(checkSenderIdentity(IDENTITY)).toEqual([]);
  });

  // A postal address cannot be defaulted or inferred, and sending without one
  // is unlawful — so absence has to block the send, not warn.
  it("reports each missing required field", () => {
    expect(checkSenderIdentity({ senderName: "X" })).toEqual(["missing_postal_address"]);
    expect(checkSenderIdentity({ postalAddress: "Y" })).toEqual(["missing_sender_name"]);
    expect(checkSenderIdentity(null)).toEqual(["missing_sender_name", "missing_postal_address"]);
    expect(checkSenderIdentity({ senderName: "  ", postalAddress: "  " })).toEqual([
      "missing_sender_name",
      "missing_postal_address",
    ]);
  });
});

describe("wrapMarketingEmail", () => {
  const wrapped = wrapMarketingEmail({
    html: "<p>Hello</p>",
    text: "Hello",
    identity: IDENTITY,
    brand: { logoUrl: "https://cdn.example/logo.png", accentHex: "#c8a24a" },
    unsubscribeUrl: "https://arc-studio.ai/api/unsubscribe?c=c-1",
  });

  it("keeps the drafted body and adds address + unsubscribe to both parts", () => {
    expect(wrapped.html).toContain("<p>Hello</p>");
    expect(wrapped.html).toContain("123 W Example St");
    expect(wrapped.html).toContain("Unsubscribe from these emails");
    expect(wrapped.text).toContain("Hello");
    expect(wrapped.text).toContain("123 W Example St");
    expect(wrapped.text).toContain("Unsubscribe: https://arc-studio.ai/api/unsubscribe?c=c-1");
  });

  it("renders a multi-line address as line breaks in html", () => {
    expect(wrapped.html).toContain("123 W Example St<br/>Chicago, IL 60601");
  });

  it("falls back to the sender name when there is no logo", () => {
    const noLogo = wrapMarketingEmail({
      html: "<p>Hi</p>",
      identity: IDENTITY,
      unsubscribeUrl: "https://x/u",
    });
    expect(noLogo.html).toContain("Big Shoulders Restoration");
    expect(noLogo.html).not.toContain("<img");
  });

  // The sender name is operator-supplied and lands in markup; a stray angle
  // bracket would otherwise break the layout or inject a tag.
  it("escapes html in operator-supplied identity fields", () => {
    const escaped = wrapMarketingEmail({
      html: "<p>Body</p>",
      identity: { senderName: '<script>x</script>', postalAddress: "1 A St" },
      unsubscribeUrl: "https://x/u",
    });
    expect(escaped.html).not.toContain("<script>");
    expect(escaped.html).toContain("&lt;script&gt;");
  });

  // A colour goes straight into a style attribute, so anything that isn't a
  // plain hex value is dropped rather than trusted.
  it("ignores a non-hex accent instead of injecting it", () => {
    const injected = wrapMarketingEmail({
      html: "<p>Body</p>",
      identity: IDENTITY,
      brand: { accentHex: "red;} body{display:none" },
      unsubscribeUrl: "https://x/u",
    });
    expect(injected.html).not.toContain("display:none");
    expect(injected.html).toContain("#c8a24a");
  });

  it("returns null for a part that wasn't supplied", () => {
    const htmlOnly = wrapMarketingEmail({ html: "<p>a</p>", identity: IDENTITY, unsubscribeUrl: "u" });
    expect(htmlOnly.text).toBeNull();
    const textOnly = wrapMarketingEmail({ text: "a", identity: IDENTITY, unsubscribeUrl: "u" });
    expect(textOnly.html).toBeNull();
  });
});

describe("buildListUnsubscribeHeaders", () => {
  // Without List-Unsubscribe-Post, Gmail won't offer one-click and some
  // scanners GET the link — silently unsubscribing people who never asked.
  it("emits both headers so one-click is honoured", () => {
    expect(buildListUnsubscribeHeaders("https://x/u")).toEqual({
      "List-Unsubscribe": "<https://x/u>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("emits nothing when there is no url", () => {
    expect(buildListUnsubscribeHeaders("")).toEqual({});
  });
});
