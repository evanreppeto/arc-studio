import { beforeEach, describe, expect, it, vi } from "vitest";

import { BRANDING_IMAGE_MAX_BYTES } from "@/domain/branding-image";

const storeGeneratedMedia = vi.fn(async () => "https://cdn.example.com/branding/logo.png");

vi.mock("@/lib/media/storage", () => ({ storeGeneratedMedia }));

const { uploadBrandingImage } = await import("./images");

beforeEach(() => {
  storeGeneratedMedia.mockClear();
});

describe("uploadBrandingImage", () => {
  it("uploads a supported image at the documented limit", async () => {
    const image = new File([new Uint8Array(BRANDING_IMAGE_MAX_BYTES)], "logo.png", { type: "image/png" });

    await expect(uploadBrandingImage("org/acme", image)).resolves.toEqual({
      ok: true,
      url: "https://cdn.example.com/branding/logo.png",
    });
    expect(storeGeneratedMedia).toHaveBeenCalledOnce();
  });

  it("rejects an image above the documented limit before storage", async () => {
    const image = new File([new Uint8Array(BRANDING_IMAGE_MAX_BYTES + 1)], "logo.png", { type: "image/png" });

    await expect(uploadBrandingImage("org/acme", image)).resolves.toEqual({
      ok: false,
      error: "Image is too large — keep it under 4MB.",
    });
    expect(storeGeneratedMedia).not.toHaveBeenCalled();
  });
});
