import { beforeEach, describe, expect, it, vi } from "vitest";

import { BRANDING_IMAGE_ACCEPT, BRANDING_IMAGE_MAX_BYTES } from "@/domain/branding-image";

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

  /**
   * SVG is script-capable, and these uploads get a permanent PUBLIC url served
   * from the project's own origin with no `Content-Disposition` and no
   * `X-Content-Type-Options: nosniff`. Rendering is safe — every call site draws
   * them through `<img src>` — but opening the stored url directly renders the
   * file as a document and runs whatever is inside it.
   *
   * Asserted against `storeGeneratedMedia` rather than the return value alone:
   * the failure that matters is the bytes reaching the public bucket, not the
   * wording of the refusal.
   */
  it("refuses an SVG, before it can reach the public bucket", async () => {
    const svg = new File(
      ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
      "logo.svg",
      { type: "image/svg+xml" },
    );

    await expect(uploadBrandingImage("org/acme", svg)).resolves.toEqual({
      ok: false,
      error: "Use a PNG, JPG, WEBP, or GIF image.",
    });
    expect(storeGeneratedMedia).not.toHaveBeenCalled();
  });

  /** The picker and the server gate have to agree. They were two separate
   *  literals until this change, and a tightened gate would have left the file
   *  dialog still offering what the action refuses. */
  it("keeps the advertised accept list free of SVG too", () => {
    expect(BRANDING_IMAGE_ACCEPT).not.toContain("svg");
    expect(BRANDING_IMAGE_ACCEPT.split(",")).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ]);
  });
});
