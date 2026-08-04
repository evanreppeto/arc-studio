import { describe, expect, it } from "vitest";

import { isPlatformAdmin } from "@/lib/waitlist/admin";

/**
 * The hole this closes: `updateOrgPlanAction` sets a paid tier with no payment,
 * and was gated only on the *workspace* admin role. In a self-serve product
 * every customer owns their own workspace, so that gate would have let anyone
 * grant themselves the Scale cap for free. The settings UI hides the picker once
 * Stripe is configured — but a hidden control is not an authorization boundary.
 *
 * These pin the allowlist semantics the action now depends on.
 */
describe("platform-admin gate for direct plan changes", () => {
  const ALLOWLIST = "founder@example.test, cofounder@example.test";

  it("permits a listed platform operator", () => {
    expect(isPlatformAdmin("founder@example.test", ALLOWLIST)).toBe(true);
    expect(isPlatformAdmin("  CoFounder@Example.Test ", ALLOWLIST)).toBe(true);
  });

  it("refuses an ordinary workspace owner", () => {
    expect(isPlatformAdmin("customer@theircompany.test", ALLOWLIST)).toBe(false);
  });

  // The important default: an unconfigured deployment must not be talked into a
  // free upgrade by anyone, including us.
  it("refuses everyone when the allowlist is unset", () => {
    expect(isPlatformAdmin("founder@example.test", undefined)).toBe(false);
    expect(isPlatformAdmin("founder@example.test", "")).toBe(false);
  });

  it("refuses a missing or blank identity", () => {
    expect(isPlatformAdmin(null, ALLOWLIST)).toBe(false);
    expect(isPlatformAdmin("   ", ALLOWLIST)).toBe(false);
  });
});
