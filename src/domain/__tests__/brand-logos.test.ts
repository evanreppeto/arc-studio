import { describe, expect, it } from "vitest";

import {
  BRAND_LOGO_LABELS,
  BRAND_LOGO_ROLES,
  emptyLogoRoles,
  isBrandLogoRole,
  pickLogoForBackground,
  primaryBrandLogo,
  type BrandLogo,
  type BrandLogoRole,
} from "@/domain/brand-logos";

const logo = (role: BrandLogoRole, url = `https://cdn/${role}.png`): BrandLogo => ({
  role,
  url,
  fileName: `${role}.png`,
  updatedAt: "2026-08-04T00:00:00.000Z",
});

describe("pickLogoForBackground", () => {
  it("uses the variant made for that background", () => {
    const set = [logo("primary"), logo("on_dark"), logo("on_light")];
    expect(pickLogoForBackground(set, "dark")?.role).toBe("on_dark");
    expect(pickLogoForBackground(set, "light")?.role).toBe("on_light");
  });

  it("falls back to the primary when no background variant exists", () => {
    const set = [logo("primary"), logo("mark")];
    expect(pickLogoForBackground(set, "dark")?.role).toBe("primary");
  });

  /**
   * The whole reason the roles exist. A white knocked-out logo on white paper
   * renders as nothing while still reporting success, and the operator
   * approving that ad cannot see what's missing. Templates have an honest
   * fallback for "no usable logo"; null is what lets them use it.
   */
  it("never falls back to the opposite background's variant", () => {
    expect(pickLogoForBackground([logo("on_light")], "dark")).toBeNull();
    expect(pickLogoForBackground([logo("on_dark")], "light")).toBeNull();
  });

  it("still returns a neutral lockup when only the opposite variant and a mark exist", () => {
    const picked = pickLogoForBackground([logo("on_light"), logo("mark")], "dark");
    expect(picked?.role).toBe("mark");
  });

  it("ignores a role present but blank", () => {
    const set = [logo("on_dark", "   "), logo("primary")];
    expect(pickLogoForBackground(set, "dark")?.role).toBe("primary");
  });

  it("returns null for an empty set", () => {
    expect(pickLogoForBackground([], "dark")).toBeNull();
  });
});

describe("primaryBrandLogo", () => {
  it("prefers the primary, then the other neutral lockups", () => {
    expect(primaryBrandLogo([logo("mark"), logo("primary")])?.role).toBe("primary");
    expect(primaryBrandLogo([logo("mark"), logo("wordmark")])?.role).toBe("wordmark");
  });

  // The rail has to show something; a background-specific variant beats nothing.
  it("falls back to a background variant rather than showing no logo at all", () => {
    expect(primaryBrandLogo([logo("on_dark")])?.role).toBe("on_dark");
  });

  it("returns null when nothing is uploaded", () => {
    expect(primaryBrandLogo([])).toBeNull();
  });
});

describe("role vocabulary", () => {
  it("labels every role, so the UI can never render a raw column value", () => {
    for (const role of BRAND_LOGO_ROLES) {
      expect(BRAND_LOGO_LABELS[role].label.length).toBeGreaterThan(0);
      expect(BRAND_LOGO_LABELS[role].hint.length).toBeGreaterThan(0);
      expect(BRAND_LOGO_LABELS[role].label).not.toBe(role);
    }
  });

  it("guards the role vocabulary at the boundary", () => {
    expect(isBrandLogoRole("on_dark")).toBe(true);
    expect(isBrandLogoRole("banner")).toBe(false);
    expect(isBrandLogoRole(null)).toBe(false);
  });

  it("reports which roles are still empty", () => {
    expect(emptyLogoRoles([logo("primary")])).toEqual(["mark", "wordmark", "on_light", "on_dark"]);
    expect(emptyLogoRoles(BRAND_LOGO_ROLES.map((r) => logo(r)))).toEqual([]);
  });
});
