import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_SUPPORT_EMAIL,
  getAppSettings,
  getSupportContactEmail,
  normalizeBrandShortName,
  normalizeBrandUrl,
  normalizeDisplayLabel,
  isValidSupportEmail,
  mergeAppSettingsRows,
  normalizeObjectLabels,
  normalizeWorkspaceName,
} from "./store";

describe("settings store helpers", () => {
  it("normalizes editable workspace names before saving", () => {
    expect(normalizeWorkspaceName("  Big Shoulders  ")).toBe("Big Shoulders");
    expect(normalizeWorkspaceName("x".repeat(100))).toHaveLength(80);
  });

  it("accepts blank support email but rejects malformed addresses", () => {
    expect(isValidSupportEmail("")).toBe(true);
    expect(isValidSupportEmail("support@bigshouldersmp.com")).toBe(true);
    expect(isValidSupportEmail("not-an-email")).toBe(false);
  });

  it("normalizes editable brand labels and logo URLs before saving", () => {
    expect(normalizeDisplayLabel("  Growth Desk  ", "Fallback", 40)).toBe("Growth Desk");
    expect(normalizeDisplayLabel("   ", "Fallback", 40)).toBe("Fallback");
    expect(normalizeDisplayLabel("x".repeat(100), "Fallback", 12)).toHaveLength(12);
    expect(normalizeBrandShortName("  bsr  ")).toBe("BSR");
    expect(normalizeBrandShortName("Growth Desk")).toBe("GROW");
    expect(normalizeBrandUrl("/brand/logo.png")).toBe("/brand/logo.png");
    expect(normalizeBrandUrl("https://example.com/logo.png")).toBe("https://example.com/logo.png");
    expect(normalizeBrandUrl("javascript:alert(1)")).toBe("");
  });

  it("merges persisted app settings without carrying dead setting rows into the app contract", () => {
    const settings = mergeAppSettingsRows([
      { key: "workspace_name", value: "Floodlight Ops" },
      { key: "workspace_profile", value: "agency" },
      { key: "industry", value: "Restoration & home services" },
      { key: "product_label", value: "Command Center" },
      { key: "assistant_name", value: "Scout" },
      { key: "assistant_tone", value: "friendly" },
      { key: "assistant_response_style", value: "detailed" },
      { key: "approval_strictness", value: "strict" },
      { key: "brand_short_name", value: "FO" },
      { key: "brand_logo_url", value: "/brand/custom-logo.png" },
      { key: "brand_favicon_url", value: "/brand/custom-icon.png" },
      { key: "support_email", value: "help@example.com" },
      { key: "arc_default_mode", value: "draft" },
      { key: "arc_default_route", value: "standard" },
      { key: "appearance_accent", value: "emerald" },
      { key: "appearance_density", value: "compact" },
      { key: "appearance_motion", value: "reduced" },
      { key: "image_model", value: "gemini-3-pro-image" },
      { key: "video_model", value: "veo-3.1-generate-preview" },
    ]);

    expect(settings).toEqual({
      workspaceName: "Floodlight Ops",
      workspaceProfile: "agency",
      industry: "Restoration & home services",
      productLabel: "Command Center",
      assistantName: "Scout",
      assistantTone: "friendly",
      assistantResponseStyle: "detailed",
      approvalStrictness: "strict",
      brandShortName: "FO",
      brandLogoUrl: "/brand/custom-logo.png",
      brandFaviconUrl: "/brand/custom-icon.png",
      supportEmail: "help@example.com",
      markDefaultMode: "draft",
      markDefaultRoute: "standard",
      appearanceAccent: "emerald",
      appearanceDensity: "compact",
      appearanceMotion: "reduced",
      imageModel: "gemini-3-pro-image",
      videoModel: "veo-3.1-generate-preview",
      journeyConsentMode: "implied",
      // Sender identity for outbound email. Blank here because this fixture
      // persists no email_* rows — and blank postal address is exactly what
      // makes the send path refuse, which is the intended default.
      emailSenderName: "",
      emailPostalAddress: "",
      emailPermissionReminder: "",
      // No stored override → empty, and the workspace keeps its industry vocabulary.
      objectLabels: {},
    });
    expect(settings).not.toHaveProperty("markWebhookEnabled");
  });

  it("falls back to safe Arc defaults when persisted rows are invalid", () => {
    const settings = mergeAppSettingsRows([
      { key: "arc_default_mode", value: "go-wild" },
      { key: "arc_default_route", value: "premium" },
      { key: "appearance_accent", value: "rainbow" },
      { key: "appearance_density", value: "tiny" },
      { key: "appearance_motion", value: "spinny" },
      { key: "workspace_profile", value: "planet" },
      { key: "product_label", value: "" },
      { key: "assistant_name", value: "" },
      { key: "assistant_tone", value: "mean" },
      { key: "assistant_response_style", value: "novel" },
      { key: "approval_strictness", value: "reckless" },
      { key: "brand_short_name", value: "" },
      { key: "brand_logo_url", value: "ftp://example.com/logo.png" },
      { key: "brand_favicon_url", value: "data:text/html;base64,PGgxPk5vPC9oMT4=" },
    ]);

    expect(settings.markDefaultMode).toBe("act");
    expect(settings.markDefaultRoute).toBe("fast");
    expect(settings.appearanceAccent).toBe("gold");
    expect(settings.appearanceDensity).toBe("comfortable");
    expect(settings.appearanceMotion).toBe("standard");
    expect(settings.workspaceProfile).toBe("company");
    expect(settings.productLabel).toBe("Marketing");
    expect(settings.assistantName).toBe("Arc");
    expect(settings.assistantTone).toBe("direct");
    expect(settings.assistantResponseStyle).toBe("balanced");
    expect(settings.approvalStrictness).toBe("standard");
    expect(settings.brandShortName).toBe("AR");
    expect(settings.brandLogoUrl).toBe("");
    expect(settings.brandFaviconUrl).toBe("/icon.png");
  });

  it("uses the saved support email before env fallbacks", () => {
    const env = { OPERATOR_SUPPORT_EMAIL: "env-support@example.com", OPERATOR_EMAIL: "operator@example.com" };

    expect(getSupportContactEmail({ supportEmail: "saved@example.com" }, env)).toBe("saved@example.com");
    expect(getSupportContactEmail({ supportEmail: "" }, env)).toBe("env-support@example.com");
    expect(getSupportContactEmail({ supportEmail: "" }, { OPERATOR_EMAIL: "operator@example.com" })).toBe("operator@example.com");
    expect(getSupportContactEmail({ supportEmail: "" }, {})).toBe(DEFAULT_SUPPORT_EMAIL);
  });

  it("uses defaults when the app settings request throws", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: async () => {
            throw new Error("fetch failed");
          },
        }),
      }),
    };

    await expect(getAppSettings("org-test", client as never)).resolves.toEqual(DEFAULT_APP_SETTINGS);
  });

  it("keeps expected app settings fallbacks quiet in production", async () => {
    const originalDebug = process.env.DEBUG_APP_SETTINGS;
    const originalVercelEnv = process.env.VERCEL_ENV;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = {
      from: () => ({
        select: () => ({
          eq: async () => {
            throw new Error("fetch failed");
          },
        }),
      }),
    };

    try {
      process.env.DEBUG_APP_SETTINGS = "1";
      process.env.VERCEL_ENV = "production";

      await expect(getAppSettings("org-test", client as never)).resolves.toEqual(DEFAULT_APP_SETTINGS);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      if (originalDebug === undefined) {
        delete process.env.DEBUG_APP_SETTINGS;
      } else {
        process.env.DEBUG_APP_SETTINGS = originalDebug;
      }
      if (originalVercelEnv === undefined) {
        delete process.env.VERCEL_ENV;
      } else {
        process.env.VERCEL_ENV = originalVercelEnv;
      }
      warn.mockRestore();
    }
  });

  it("scopes the settings read to the given workspace org", async () => {
    let filteredColumn: string | null = null;
    let filteredValue: string | null = null;
    const client = {
      from: () => ({
        select: () => ({
          eq: async (column: string, value: string) => {
            filteredColumn = column;
            filteredValue = value;
            return { data: [{ key: "assistant_name", value: "Scout" }], error: null };
          },
        }),
      }),
    };

    const settings = await getAppSettings("org-42", client as never);
    expect(filteredColumn).toBe("org_id");
    expect(filteredValue).toBe("org-42");
    expect(settings.assistantName).toBe("Scout");
  });

  it("returns app defaults without querying when there is no workspace org", async () => {
    let queried = false;
    const client = {
      from: () => {
        queried = true;
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      },
    };

    await expect(getAppSettings(null, client as never)).resolves.toEqual(DEFAULT_APP_SETTINGS);
    expect(queried).toBe(false);
  });
});

describe("normalizeObjectLabels", () => {
  it("keeps a complete override", () => {
    expect(normalizeObjectLabels({ objects: { properties: { plural: "Matters", singular: "matter" } } })).toEqual({
      objects: { properties: { plural: "Matters", singular: "matter" } },
    });
  });

  it("keeps a section rename", () => {
    expect(normalizeObjectLabels({ section: "  Matters " })).toEqual({ section: "Matters" });
  });

  // Validating on the way OUT as well as in: this is a jsonb row, so a
  // hand-edited value must not reach the UI.
  it("drops a half-filled override rather than rendering a mixed screen", () => {
    expect(normalizeObjectLabels({ objects: { properties: { plural: "Matters", singular: "" } } })).toEqual({});
  });

  it("drops unknown object keys instead of letting them accumulate", () => {
    const result = normalizeObjectLabels({
      objects: {
        properties: { plural: "Matters", singular: "matter" },
        invoices: { plural: "Invoices", singular: "invoice" },
      },
    });
    expect(result.objects).toEqual({ properties: { plural: "Matters", singular: "matter" } });
  });

  it.each([
    ["null", null],
    ["a string", "Matters"],
    ["an array", []],
  ])("returns empty for malformed input (%s)", (_label, input) => {
    expect(normalizeObjectLabels(input)).toEqual({});
  });

  it("round-trips through the merge as an app setting", () => {
    const settings = mergeAppSettingsRows([
      { key: "crm_object_labels", value: { section: "Matters", objects: { properties: { plural: "Matters", singular: "matter" } } } },
    ]);
    expect(settings.objectLabels.section).toBe("Matters");
    expect(settings.objectLabels.objects?.properties).toEqual({ plural: "Matters", singular: "matter" });
  });

  it("survives a garbage stored row without breaking settings", () => {
    const settings = mergeAppSettingsRows([{ key: "crm_object_labels", value: "not an object" }]);
    expect(settings.objectLabels).toEqual({});
  });
});
