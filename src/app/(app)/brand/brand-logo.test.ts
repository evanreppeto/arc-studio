import { beforeEach, describe, expect, it, vi } from "vitest";

import { NEUTRAL_DEFAULTS, type BusinessProfile } from "@/domain";

/**
 * The Brand screen's logo control. It writes through `setWorkspaceLogo` — the
 * single store shared with the Settings control — so an upload here also changes
 * the nav rail, and vice versa. Store-level behaviour is covered in
 * `src/lib/branding/logo.test.ts`; these cover the action around it.
 */
// Params are declared so `mock.calls[n][i]` is typed — a bare `vi.fn(async () => …)`
// infers a zero-arg tuple and indexing it fails typecheck.
const setLogo = vi.fn(async (_orgId: string, _url: string | null) => {});
const upload = vi.fn(async (_prefix: string, _file: File) => ({ ok: true as const, url: "https://cdn.example/branding/logo.png" }));
const state = { configured: true, orgId: "org-1" as string | null };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/operator", () => ({ requireOperator: vi.fn(async () => {}), getOperatorActor: vi.fn(async () => "evan") }));
vi.mock("@/lib/auth/org", () => ({ getCurrentOrgId: vi.fn(async () => "org-1") }));
vi.mock("@/lib/auth/workspace", () => ({ getCurrentWorkspaceContext: vi.fn(async () => ({ orgId: state.orgId })) }));
vi.mock("@/lib/branding/images", () => ({ uploadBrandingImage: upload }));
vi.mock("@/lib/branding/logo", () => ({ setWorkspaceLogo: setLogo }));
vi.mock("@/lib/brand-kit/persistence", () => ({
  getBusinessProfile: vi.fn(async () => ({ ...NEUTRAL_DEFAULTS, displayName: "Summit", tagline: "Handled." })),
  upsertBusinessProfile: vi.fn(),
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
  setLogo.mockClear();
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
    // One store, shared with Settings — not a Brand-only field.
    expect(setLogo).toHaveBeenCalledWith("org-1", "https://cdn.example/branding/logo.png");
  });

  it("rejects an empty pick without uploading or writing", async () => {
    expect(await saveBrandLogo(form(null))).toEqual({ ok: false, error: "Choose an image first." });
    expect(await saveBrandLogo(form(new File([], "empty.png", { type: "image/png" })))).toEqual({ ok: false, error: "Choose an image first." });
    expect(upload).not.toHaveBeenCalled();
    expect(setLogo).not.toHaveBeenCalled();
  });

  it("surfaces an upload rejection instead of writing a broken URL", async () => {
    upload.mockResolvedValueOnce({ ok: false, error: "Use a PNG, JPG, WEBP, GIF, or SVG image." } as never);
    expect(await saveBrandLogo(form(new File(["x"], "logo.tiff", { type: "image/tiff" })))).toEqual({
      ok: false,
      error: "Use a PNG, JPG, WEBP, GIF, or SVG image.",
    });
    expect(setLogo).not.toHaveBeenCalled();
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
  it("clears the logo through the shared store", async () => {
    expect(await removeBrandLogo()).toEqual({ ok: true, url: null });
    expect(setLogo).toHaveBeenCalledWith("org-1", null);
  });

  it("reports a write failure rather than claiming success", async () => {
    setLogo.mockRejectedValueOnce(new Error("row level security"));
    expect(await removeBrandLogo()).toEqual({ ok: false, error: "row level security" });
  });
});
