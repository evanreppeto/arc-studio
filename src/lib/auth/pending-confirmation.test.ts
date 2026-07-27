import { describe, expect, it } from "vitest";

import { inboxProviderUrl, readPendingConfirmationEmail } from "./pending-confirmation";

describe("readPendingConfirmationEmail", () => {
  it("accepts a normal address and trims surrounding space", () => {
    expect(readPendingConfirmationEmail("  evan@example.com ")).toBe("evan@example.com");
  });

  it("rejects anything that isn't an address, so a hand-edited cookie can't be echoed onto the page", () => {
    expect(readPendingConfirmationEmail(undefined)).toBeNull();
    expect(readPendingConfirmationEmail("")).toBeNull();
    expect(readPendingConfirmationEmail("not-an-email")).toBeNull();
    expect(readPendingConfirmationEmail("evan@localhost")).toBeNull();
    expect(readPendingConfirmationEmail("<script>alert(1)</script>")).toBeNull();
    expect(readPendingConfirmationEmail("a@b.co ; rm -rf /")).toBeNull();
  });

  it("rejects an over-long value", () => {
    expect(readPendingConfirmationEmail(`${"a".repeat(250)}@example.com`)).toBeNull();
  });
});

describe("inboxProviderUrl", () => {
  it("offers a webmail shortcut for the consumer providers", () => {
    expect(inboxProviderUrl("evan@gmail.com")?.label).toBe("Open Gmail");
    expect(inboxProviderUrl("evan@Outlook.com")?.label).toBe("Open Outlook");
    expect(inboxProviderUrl("evan@icloud.com")?.label).toBe("Open iCloud Mail");
  });

  it("omits the shortcut for work domains, where no inbox URL is knowable", () => {
    expect(inboxProviderUrl("evan@bigshouldersrestoration.com")).toBeNull();
    expect(inboxProviderUrl("malformed")).toBeNull();
  });
});
