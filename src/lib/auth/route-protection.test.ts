import { describe, expect, it } from "vitest";

import { getWorkspaceAccessDecision, isPublicPath } from "./route-protection";

describe("getWorkspaceAccessDecision", () => {
  it("sends signed-in users without workspace access to onboarding", () => {
    expect(
      getWorkspaceAccessDecision({ hasWorkspace: false, isSignedIn: true, pathname: "/arc" }),
    ).toEqual({ action: "onboarding" });
  });

  it("allows onboarding while a signed-in user is still creating a workspace", () => {
    expect(
      getWorkspaceAccessDecision({ hasWorkspace: false, isSignedIn: true, pathname: "/onboarding" }),
    ).toEqual({ action: "allow" });
  });

  it("sends logged-out users to login", () => {
    expect(
      getWorkspaceAccessDecision({ hasWorkspace: false, isSignedIn: false, pathname: "/arc" }),
    ).toEqual({ action: "login" });
  });

  it("sends a signed-in member from the root into the app", () => {
    expect(
      getWorkspaceAccessDecision({ hasWorkspace: true, isSignedIn: true, pathname: "/" }),
    ).toEqual({ action: "app" });
  });

  it("allows a signed-in member into app routes", () => {
    for (const pathname of ["/home", "/campaigns", "/settings/team"]) {
      expect(
        getWorkspaceAccessDecision({ hasWorkspace: true, isSignedIn: true, pathname }),
      ).toEqual({ action: "allow" });
    }
  });

  it("lets a logged-out visitor through on the root, where the landing page renders", () => {
    expect(
      getWorkspaceAccessDecision({ hasWorkspace: false, isSignedIn: false, pathname: "/" }),
    ).toEqual({ action: "allow" });
  });
});

describe("isPublicPath", () => {
  it("keeps static assets public in every mode", () => {
    for (const mode of ["open", "operator", "supabase"] as const) {
      expect(isPublicPath("/some-logo.png", mode)).toBe(true);
      expect(isPublicPath("/icon-192.png", mode)).toBe(true);
      expect(isPublicPath("/site.webmanifest", mode)).toBe(true);
      expect(isPublicPath("/styles.css", mode)).toBe(true);
    }
  });

  it("keeps the root landing public in open/operator mode but gates it in supabase mode", () => {
    for (const mode of ["open", "operator"] as const) {
      expect(isPublicPath("/", mode)).toBe(true);
    }
    // Supabase mode: the root is gated so an unauthenticated visitor is sent to
    // the standalone /login screen.
    expect(isPublicPath("/", "supabase")).toBe(false);
  });

  it("keeps robots.txt and sitemap.xml crawlable in supabase mode", () => {
    // If the auth gate ever swallows these, search engines get a redirect to
    // /login instead of the files, and the site silently drops out of the index.
    expect(isPublicPath("/robots.txt", "supabase")).toBe(true);
    expect(isPublicPath("/sitemap.xml", "supabase")).toBe(true);
  });

  it("gates real app routes in supabase mode", () => {
    for (const pathname of ["/crm", "/arc", "/home"]) {
      expect(isPublicPath(pathname, "supabase")).toBe(false);
    }
  });

  it("keeps /pricing public in every mode", () => {
    // A prospect has to read pricing before they have an account. If the gate
    // ever swallows this, the page 302s to /login and the pricing link on the
    // landing page becomes a dead end for exactly the audience it's for.
    for (const mode of ["open", "operator", "supabase"] as const) {
      expect(isPublicPath("/pricing", mode)).toBe(true);
      expect(isPublicPath("/pricing/", mode)).toBe(true);
    }
  });

  it("keeps /compare and its comparison pages public in every mode", () => {
    // Comparison pages are an organic search entry point — they are read by
    // strangers who have no account and never will unless the page converts
    // them. Gating them turns the highest-intent traffic we get into a 302.
    for (const mode of ["open", "operator", "supabase"] as const) {
      expect(isPublicPath("/compare", mode)).toBe(true);
      expect(isPublicPath("/compare/vs-agency", mode)).toBe(true);
      expect(isPublicPath("/compare/vs-hubspot", mode)).toBe(true);
    }
  });

  it("does not let a public marketing path leak neighbouring routes by prefix", () => {
    // The exposure this guards against: a bare-prefix match on a page name also
    // exempts every route that merely STARTS with it, so an unrelated gated page
    // silently renders to signed-out visitors. Only the exact path and real
    // sub-paths may be public.
    for (const pathname of [
      "/pricing-internal",
      "/pricingsecret",
      "/pricing-admin/rates",
      "/compare-internal",
      "/comparesecret",
      "/compare-admin/tenants",
    ]) {
      expect(isPublicPath(pathname, "supabase")).toBe(false);
    }
  });
});
