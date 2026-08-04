import { afterEach, describe, expect, it, vi } from "vitest";


// Static, not `await import(…)` inside each test: `vi.mock` is hoisted above
// imports, so the mocks apply either way. The dynamic form bought nothing and
// charged this file's module transform to whichever test ran first (BSR-739).
import { AI_FOLDER_NAME, generatedFileName, recordGeneratedMedia } from "./library-record";

/**
 * BSR-634: generated media has to reach the Library.
 *
 * Verified on prod before this existed: a real generation produced a 959 KB JPEG
 * in the bucket, a campaign asset, an approval item and a metered 6¢ — while
 * `/library` read "0 images, 0 stored". The bytes were real and unreusable.
 *
 * These tests pin the two halves that made it invisible: that a row is written at
 * all, and that failing to write one never breaks an already-metered generation.
 */

const recordStoredAsset = vi.fn();
const ensureNamedFolder = vi.fn();
const isSupabaseAdminConfigured = vi.fn(() => true);

vi.mock("@/lib/media-library/persistence", () => ({
  recordStoredAsset: (...args: unknown[]) => recordStoredAsset(...args),
  ensureNamedFolder: (...args: unknown[]) => ensureNamedFolder(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: () => isSupabaseAdminConfigured(),
  getSupabaseAdminClient: () => ({}),
}));


const base = {
  orgId: "org-1",
  objectPath: "arc-generated/org-1/ws-1/e8d9e6e6.jpg",
  publicUrl: "https://cdn.example.test/e8d9e6e6.jpg",
  contentType: "image/jpeg",
  kind: "image" as const,
  byteSize: 959_560,
  prompt: "Exterior of a suburban home on an overcast day",
  model: "gemini-image",
  format: "4:3",
};

afterEach(() => {
  recordStoredAsset.mockReset();
  ensureNamedFolder.mockReset();
  isSupabaseAdminConfigured.mockReturnValue(true);
});

describe("recordGeneratedMedia", () => {
  it("writes a library row pointing at the object the generator already stored", async () => {
    ensureNamedFolder.mockResolvedValue("folder-ai");
    recordStoredAsset.mockResolvedValue("asset-1");

    const id = await recordGeneratedMedia(base);

    expect(id).toBe("asset-1");
    expect(ensureNamedFolder).toHaveBeenCalledWith("org-1", AI_FOLDER_NAME, expect.any(String));
    expect(recordStoredAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        folderId: "folder-ai",
        // The object is NOT re-uploaded or moved — the arc-generated prefix stands.
        storagePath: "arc-generated/org-1/ws-1/e8d9e6e6.jpg",
        publicUrl: "https://cdn.example.test/e8d9e6e6.jpg",
        kind: "image",
        byteSize: 959_560,
        source: "ai_generated",
        availableToArc: false,
      }),
    );
  });

  it("records provenance a reviewer can act on", async () => {
    ensureNamedFolder.mockResolvedValue(null);
    recordStoredAsset.mockResolvedValue("asset-1");

    await recordGeneratedMedia(base);

    const { provenance, tags } = recordStoredAsset.mock.calls[0]![0] as {
      provenance: Record<string, unknown>;
      tags: string[];
    };
    expect(provenance).toMatchObject({
      generator: "arc",
      model: "gemini-image",
      format: "4:3",
      prompt: "Exterior of a suburban home on an overcast day",
    });
    expect(tags).toContain("ai-generated");
  });

  it("holds generated media for review rather than handing it straight back to Arc", async () => {
    // Unreviewed AI creative flowing into the next campaign is the failure this
    // default exists to prevent.
    ensureNamedFolder.mockResolvedValue("folder-ai");
    recordStoredAsset.mockResolvedValue("asset-1");
    await recordGeneratedMedia(base);
    expect((recordStoredAsset.mock.calls[0]![0] as { availableToArc: boolean }).availableToArc).toBe(false);
  });

  it("returns null instead of throwing when the row cannot be written", async () => {
    // The generation already happened and was already metered. Turning that into
    // a 502 would charge for an image and then report failure.
    ensureNamedFolder.mockResolvedValue("folder-ai");
    recordStoredAsset.mockRejectedValue(new Error("insert failed"));
    await expect(recordGeneratedMedia(base)).resolves.toBeNull();
  });

  it("no-ops without an org or a backend", async () => {
    expect(await recordGeneratedMedia({ ...base, orgId: null })).toBeNull();
    isSupabaseAdminConfigured.mockReturnValue(false);
    expect(await recordGeneratedMedia(base)).toBeNull();
    expect(recordStoredAsset).not.toHaveBeenCalled();
  });

  it("still records the asset when the folder lookup fails, filing it at the root", async () => {
    // Filing is organisation; the row is the point. Losing a generated asset
    // because a folder query failed would reintroduce the exact bug this fixes.
    ensureNamedFolder.mockRejectedValue(new Error("folder blew up"));
    recordStoredAsset.mockResolvedValue("asset-1");

    await expect(recordGeneratedMedia(base)).resolves.toBe("asset-1");
    expect((recordStoredAsset.mock.calls[0]![0] as { folderId: string | null }).folderId).toBeNull();
  });
});

describe("generatedFileName", () => {
  it("names the file from the prompt so the Library is scannable", () => {
    expect(generatedFileName({ prompt: "Exterior of a suburban home on an overcast day", objectPath: "a/b/c.jpg", kind: "image" }))
      .toBe("Exterior of a suburban home on an.jpg");
  });

  it("falls back to the object's own name when there is no prompt", () => {
    expect(generatedFileName({ objectPath: "arc-generated/o/w/uuid.mp4", kind: "video" })).toBe("uuid.mp4");
  });

  it("strips characters that would break a file name", () => {
    expect(generatedFileName({ prompt: "Storm/damage: 40% off!", objectPath: "a/b.jpg", kind: "image" }))
      .toBe("Stormdamage 40 off.jpg");
  });
});
