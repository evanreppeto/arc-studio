import { beforeEach, describe, expect, it, vi } from "vitest";

import { NEUTRAL_DEFAULTS, type BusinessProfile } from "@/domain";

const upsert = vi.fn(async (_orgId: string, _profile: BusinessProfile) => {});
const saveSettings = vi.fn(async (_client: unknown, _orgId: string, _patch: Record<string, string>) => {});

vi.mock("@/lib/brand-kit/persistence", () => ({
  getBusinessProfile: vi.fn(async () => ({ ...NEUTRAL_DEFAULTS, displayName: "Summit", tagline: "Handled." })),
  upsertBusinessProfile: upsert,
}));
vi.mock("@/lib/settings/store", () => ({ saveAppSettings: saveSettings }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdminClient: vi.fn(() => ({})) }));

const { resolveWorkspaceLogoUrl, setWorkspaceLogo } = await import("./logo");

beforeEach(() => {
  upsert.mockClear();
  saveSettings.mockClear();
});

/**
 * The logo used to live in two stores — `app_settings.brand_logo_url` (rail) and
 * `business_profiles.logo_url` (creative) — so a workspace could wear one logo
 * in the app and a different one on its ads. These pin the single-store rule.
 */
describe("resolveWorkspaceLogoUrl", () => {
  it("prefers the canonical brand record over the legacy settings key", () => {
    expect(resolveWorkspaceLogoUrl("https://cdn/new.png", "https://cdn/old.png")).toBe("https://cdn/new.png");
  });

  it("falls back to the legacy key for workspaces that uploaded before the merge", () => {
    expect(resolveWorkspaceLogoUrl(null, "https://cdn/old.png")).toBe("https://cdn/old.png");
    expect(resolveWorkspaceLogoUrl(undefined, "https://cdn/old.png")).toBe("https://cdn/old.png");
  });

  it("ignores values the creative renderer could not fetch", () => {
    // The renderer fetches this URL server-side: a bundled default or a data:
    // URL is fine for the rail but would 404 or bloat a render.
    expect(resolveWorkspaceLogoUrl(null, "/brand/arc-mark.png")).toBeNull();
    expect(resolveWorkspaceLogoUrl("data:image/png;base64,iVBOR", null)).toBeNull();
    expect(resolveWorkspaceLogoUrl("", "")).toBeNull();
    expect(resolveWorkspaceLogoUrl(null, null)).toBeNull();
  });
});

describe("setWorkspaceLogo", () => {
  it("writes the canonical record and clears the legacy key in one call", async () => {
    await setWorkspaceLogo("org-1", "https://cdn/new.png");

    expect(upsert).toHaveBeenCalledWith("org-1", expect.objectContaining({ logoUrl: "https://cdn/new.png" }));
    // Clearing the legacy key is what stops the two stores drifting again.
    expect(saveSettings.mock.calls[0][2]).toEqual({ brand_logo_url: "" });
  });

  it("merges — the rest of the brand profile survives a logo change", async () => {
    await setWorkspaceLogo("org-1", "https://cdn/new.png");
    expect(upsert.mock.calls[0][1]).toEqual(expect.objectContaining({ displayName: "Summit", tagline: "Handled." }));
  });

  it("clears both stores on remove, so a legacy value can't resurrect", async () => {
    await setWorkspaceLogo("org-1", null);
    expect(upsert).toHaveBeenCalledWith("org-1", expect.objectContaining({ logoUrl: null }));
    expect(saveSettings.mock.calls[0][2]).toEqual({ brand_logo_url: "" });
  });

  it("still succeeds when clearing the legacy key fails — the canonical write is what counts", async () => {
    saveSettings.mockRejectedValueOnce(new Error("settings unavailable"));
    await expect(setWorkspaceLogo("org-1", "https://cdn/new.png")).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalled();
  });

  it("propagates a canonical write failure instead of swallowing it", async () => {
    upsert.mockRejectedValueOnce(new Error("row level security"));
    await expect(setWorkspaceLogo("org-1", "https://cdn/new.png")).rejects.toThrow("row level security");
  });
});
