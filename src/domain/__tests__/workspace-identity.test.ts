import { describe, expect, it } from "vitest";

import {
  derivedShortLabel,
  isWorkspaceAccentKey,
  normalizeWorkspaceIdentityPatch,
  resolveWorkspaceIdentity,
  WORKSPACE_ACCENT_SWATCHES,
  workspaceInitials,
  type WorkspaceIdentity,
} from "../workspace-identity";

const UNCUSTOMIZED: WorkspaceIdentity = {
  name: "Big Shoulders Restoration",
  subtitle: null,
  shortLabel: null,
  accentKey: null,
  logoUrl: null,
};

describe("resolveWorkspaceIdentity", () => {
  // The whole migration rests on this: nobody's sidebar changes until they edit it.
  it("reproduces the pre-identity rail exactly when nothing is customized", () => {
    const resolved = resolveWorkspaceIdentity(UNCUSTOMIZED, "Big Shoulders Restoration");

    expect(resolved.name).toBe("Big Shoulders Restoration");
    // The grey line used to be the org name, because the coupled rename kept the
    // two rows identical.
    expect(resolved.subtitle).toBe("Big Shoulders Restoration");
    // The pill used to be `orgName.split(/\s+/)[0].toUpperCase() + " workspace"`.
    expect(resolved.shortLabel).toBe("BIG workspace");
    // And every workspace inherited the one org-wide accent.
    expect(resolved.accentColor).toBeNull();
  });

  it("lets the subtitle differ from the organization name", () => {
    const resolved = resolveWorkspaceIdentity(
      { ...UNCUSTOMIZED, name: "Restoration · Chicago", subtitle: "Emergency water + fire" },
      "Big Shoulders Restoration",
    );

    expect(resolved.name).toBe("Restoration · Chicago");
    expect(resolved.subtitle).toBe("Emergency water + fire");
    // The pill still falls back to the org name — it was not overridden.
    expect(resolved.shortLabel).toBe("BIG workspace");
  });

  it("overrides the pill without touching anything else", () => {
    const resolved = resolveWorkspaceIdentity({ ...UNCUSTOMIZED, shortLabel: "FIELD OPS" }, "Big Shoulders Restoration");

    expect(resolved.shortLabel).toBe("FIELD OPS");
    expect(resolved.subtitle).toBe("Big Shoulders Restoration");
  });

  it("maps a stored accent key to its swatch, and an unknown one to inherit", () => {
    expect(resolveWorkspaceIdentity({ ...UNCUSTOMIZED, accentKey: "emerald" }, "Org").accentColor).toBe(
      WORKSPACE_ACCENT_SWATCHES.emerald,
    );
    // Defensive: the DB check constraint should make this impossible, but a bad
    // value must inherit rather than reach a CSS custom property.
    expect(
      resolveWorkspaceIdentity({ ...UNCUSTOMIZED, accentKey: "chartreuse" as never }, "Org").accentColor,
    ).toBeNull();
  });

  it("treats whitespace-only stored values as unset", () => {
    const resolved = resolveWorkspaceIdentity(
      { ...UNCUSTOMIZED, subtitle: "   ", shortLabel: "  ", logoUrl: " " },
      "Summit Restoration",
    );

    expect(resolved.subtitle).toBe("Summit Restoration");
    expect(resolved.shortLabel).toBe("SUMMIT workspace");
    expect(resolved.logoUrl).toBeNull();
  });

  it("falls back to the org name when the workspace has no name of its own", () => {
    expect(resolveWorkspaceIdentity({ ...UNCUSTOMIZED, name: "  " }, "Summit").name).toBe("Summit");
  });
});

describe("derivedShortLabel", () => {
  it("uses the first word, uppercased", () => {
    expect(derivedShortLabel("Big Shoulders Restoration")).toBe("BIG workspace");
    expect(derivedShortLabel("Summit")).toBe("SUMMIT workspace");
  });

  it("does not produce a leading space when the org name is empty", () => {
    expect(derivedShortLabel("   ")).toBe("Workspace");
  });
});

describe("workspaceInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(workspaceInitials("Big Shoulders Restoration")).toBe("BS");
    expect(workspaceInitials("Personal")).toBe("P");
    expect(workspaceInitials("")).toBe("A");
  });

  it("skips separator words instead of putting them in the monogram", () => {
    // "Restoration · Chicago" used to render as "R·".
    expect(workspaceInitials("Restoration · Chicago")).toBe("RC");
    expect(workspaceInitials("Field — Ops")).toBe("FO");
    expect(workspaceInitials("· ·")).toBe("A");
  });
});

describe("normalizeWorkspaceIdentityPatch", () => {
  it("leaves absent fields absent, so a partial save touches only what changed", () => {
    const result = normalizeWorkspaceIdentityPatch({ name: "Field Ops" });
    expect(result).toEqual({ ok: true, patch: { name: "Field Ops" } });
  });

  it("rejects a present-but-blank name rather than deleting it", () => {
    expect(normalizeWorkspaceIdentityPatch({ name: "   " })).toEqual({
      ok: false,
      error: "A workspace name is required.",
    });
    expect(normalizeWorkspaceIdentityPatch({ orgName: "" })).toEqual({
      ok: false,
      error: "An organization name is required.",
    });
  });

  it("treats a blank optional field as a clear, restoring the fallback", () => {
    const result = normalizeWorkspaceIdentityPatch({ subtitle: "  ", shortLabel: "", accentKey: "" });
    expect(result).toEqual({ ok: true, patch: { subtitle: null, shortLabel: null, accentKey: null } });
  });

  it("rejects an accent that is not one of the named themes", () => {
    expect(normalizeWorkspaceIdentityPatch({ accentKey: "#ff0000" })).toEqual({
      ok: false,
      error: "Pick one of the available workspace colors.",
    });
  });

  it("clamps overlong values instead of failing the save", () => {
    const result = normalizeWorkspaceIdentityPatch({ name: "x".repeat(200), shortLabel: "y".repeat(200) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.name).toHaveLength(80);
    expect(result.patch.shortLabel).toHaveLength(32);
  });

  it("trims before storing", () => {
    const result = normalizeWorkspaceIdentityPatch({ name: "  Field Ops  ", subtitle: "  Chicago metro " });
    expect(result).toEqual({ ok: true, patch: { name: "Field Ops", subtitle: "Chicago metro" } });
  });
});

describe("isWorkspaceAccentKey", () => {
  it("accepts the five named accents and nothing else", () => {
    expect(isWorkspaceAccentKey("gold")).toBe(true);
    expect(isWorkspaceAccentKey("emerald")).toBe(true);
    expect(isWorkspaceAccentKey("purple")).toBe(false);
    expect(isWorkspaceAccentKey(null)).toBe(false);
    expect(isWorkspaceAccentKey(undefined)).toBe(false);
  });
});
