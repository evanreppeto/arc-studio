import { beforeEach, describe, expect, it, vi } from "vitest";

import { NEUTRAL_DEFAULTS } from "@/domain";

/**
 * `business_profiles.logo_url` is the mark `toBrandTokens` hands to
 * `renderCreative`, so it lands on every composed ad — but nothing could write
 * it: the only writer was `buildBusinessProfileFromForm`, which has no callers.
 * These cover the write path the Brand screen's control now uses.
 */
const upsert = vi.fn(async () => {});
const upload = vi.fn(async () => ({ ok: true as const, url: "https://cdn.example/branding/logo.png" }));
const state = { configured: true, orgId: "org-1" as string | null };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/operator", () => ({ requireOperator: vi.fn(async () => {}), getOperatorActor: vi.fn(async () => "evan") }));
vi.mock("@/lib/auth/org", () => ({ getCurrentOrgId: vi.fn(async () => "org-1") }));
vi.mock("@/lib/auth/workspace", () => ({ getCurrentWorkspaceContext: vi.fn(async () => ({ orgId: state.orgId })) }));
vi.mock("@/lib/branding/images", () => ({ uploadBrandingImage: upload }));
vi.mock("@/lib/brand-kit/persistence", () => ({
  getBusinessProfile: vi.fn(async () => ({ ...NEUTRAL_DEFAULTS, displayName: "Summit", tagline: "Handled." })),
  upsertBusinessProfile: upsert,
}));
vi.mock("@/lib/brand-kit/website-fetch", () => ({ fetchBrandSignalFromUrl: vi.fn() }));
vi.mock("@/lib/brand-knowledge/asset-text", () => ({ extractAssetText: vi.fn() }));
vi.mock("@/lib/brand-knowledge/brain-sync", () => ({ learnBrandKnowledgeFromAsset: vi.fn() }));
vi.mock("@/lib/brand-knowledge/sources-read-model", () => ({ getBrandSource: vi.fn(), listBrandSources: vi.fn() }));
vi.mock("@/lib/media-library/persistence", () => ({ insertAssetWithUrl: vi.fn(), loadAssetForLearning: vi.fn() }));
vi.mock("@/lib/media-library/upload-policy", () => ({ MAX_UPLOAD_BYTES: 1, acceptUpload: vi.fn(), kindForContentType: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ isSupabaseAdminConfigured: vi.fn(() => state.configured) }));

const { saveBrandLogo, removeBrandLogo } = await import("./actions");

function form(file: File | null): FormData {
  const data = new FormData();
  if (file) data.append("file", file);
  return data;
}

beforeEach(() => {
  upsert.mockClear();
  upload.mockClear();
  state.configured = true;
  state.orgId = "org-1";
});

describe("saveBrandLogo", () => {
  it("stores the image and writes its URL to the org's brand profile", async () => {
    const result = await saveBrandLogo(form(new File(["x"], "logo.png", { type: "image/png" })));

    expect(result).toEqual({ ok: true, url: "https://cdn.example/branding/logo.png" });
    // Scoped to the caller's own workspace, not a path from the browser.
    expect(upload.mock.calls[0][0]).toBe("org/org-1/brand");
    expect(upsert).toHaveBeenCalledWith("org-1", expect.objectContaining({ logoUrl: "https://cdn.example/branding/logo.png" }));
  });

  it("preserves the rest of the profile — this is a merge, not a replace", async () => {
    await saveBrandLogo(form(new File(["x"], "logo.png", { type: "image/png" })));
    expect(upsert.mock.calls[0][1]).toEqual(expect.objectContaining({ displayName: "Summit", tagline: "Handled." }));
  });

  it("rejects an empty pick without uploading or writing", async () => {
    expect(await saveBrandLogo(form(null))).toEqual({ ok: false, error: "Choose an image first." });
    expect(await saveBrandLogo(form(new File([], "empty.png", { type: "image/png" })))).toEqual({ ok: false, error: "Choose an image first." });
    expect(upload).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("surfaces an upload rejection instead of writing a broken URL", async () => {
    upload.mockResolvedValueOnce({ ok: false, error: "Use a PNG, JPG, WEBP, GIF, or SVG image." } as never);
    expect(await saveBrandLogo(form(new File(["x"], "logo.tiff", { type: "image/tiff" })))).toEqual({
      ok: false,
      error: "Use a PNG, JPG, WEBP, GIF, or SVG image.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("says so honestly when there is no workspace to write to", async () => {
    state.configured = false;
    expect(await saveBrandLogo(form(new File(["x"], "logo.png", { type: "image/png" })))).toEqual({
      ok: false,
      error: "Connect a workspace to upload a logo.",
    });

    state.configured = true;
    state.orgId = null;
    expect(await saveBrandLogo(form(new File(["x"], "logo.png", { type: "image/png" })))).toEqual({ ok: false, error: "No active workspace." });
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("removeBrandLogo", () => {
  it("clears the logo without touching the rest of the profile", async () => {
    expect(await removeBrandLogo()).toEqual({ ok: true, url: null });
    expect(upsert).toHaveBeenCalledWith("org-1", expect.objectContaining({ logoUrl: null, displayName: "Summit" }));
  });

  it("reports a write failure rather than claiming success", async () => {
    upsert.mockRejectedValueOnce(new Error("row level security"));
    expect(await removeBrandLogo()).toEqual({ ok: false, error: "row level security" });
  });
});
