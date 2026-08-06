import { describe, expect, it } from "vitest";

import {
  DEFAULT_MEDIA_CONFIG,
  MEDIA_AUTO,
  effectiveMediaModel,
  parseMediaConfig,
  resolveMediaDefaults,
} from "../media-config";

describe("parseMediaConfig", () => {
  it("returns the full default config from empty / junk input", () => {
    for (const raw of [undefined, null, 42, "x", {}]) {
      expect(parseMediaConfig(raw)).toEqual(DEFAULT_MEDIA_CONFIG);
    }
  });

  it("keeps a valid per-category override, upgrading a bare id to its engine key", () => {
    // Defaults are stored engine-qualified now that both engines are selectable;
    // a bare id from the pre-namespace shape still reads as Higgsfield.
    const cfg = parseMediaConfig({ autoPick: false, defaults: { video: "veo3_1" } });
    expect(cfg.defaults.video).toBe("higgsfield:veo3_1");
    expect(parseMediaConfig({ autoPick: false, defaults: { video: "higgsfield:veo3_1" } }).defaults.video).toBe("higgsfield:veo3_1");
  });

  it("keeps a Gemini pick as a per-category override too", () => {
    const cfg = parseMediaConfig({ autoPick: false, defaults: { image: "gemini:gemini-3-pro-image" } });
    expect(cfg.defaults.image).toBe("gemini:gemini-3-pro-image");
  });

  it("does not report a Gemini pick to the runner as a Higgsfield lock", () => {
    // The Gemini pick is enforced app-side as a real argument; telling Arc it was
    // an operator-locked Higgsfield model would name an id Higgsfield can't run.
    const cfg = parseMediaConfig({ autoPick: false, defaults: { image: "gemini:gemini-3-pro-image" } });
    expect(resolveMediaDefaults(cfg).image?.explicit).toBe(false);
  });

  it("normalizes a wrong-category override back to auto (veo is a video model)", () => {
    const cfg = parseMediaConfig({ defaults: { image: "veo3_1" } });
    expect(cfg.defaults.image).toBe(MEDIA_AUTO);
  });

  it("normalizes an unknown/retired model id back to auto", () => {
    const cfg = parseMediaConfig({ defaults: { image: "totally_made_up" } });
    expect(cfg.defaults.image).toBe(MEDIA_AUTO);
  });

  it("falls back to the default aspect on an invalid aspect", () => {
    expect(parseMediaConfig({ defaultAspect: "3:2" }).defaultAspect).toBe(DEFAULT_MEDIA_CONFIG.defaultAspect);
    expect(parseMediaConfig({ defaultAspect: "9:16" }).defaultAspect).toBe("9:16");
  });

  it("coerces non-boolean toggles to their defaults", () => {
    const cfg = parseMediaConfig({ allowVideo: "yes", preferRealMedia: 0 });
    expect(cfg.allowVideo).toBe(DEFAULT_MEDIA_CONFIG.allowVideo);
    expect(cfg.preferRealMedia).toBe(DEFAULT_MEDIA_CONFIG.preferRealMedia);
  });
});

describe("effectiveMediaModel", () => {
  it("auto-picks the recommended model when autoPick is on, ignoring overrides", () => {
    const cfg = parseMediaConfig({ autoPick: true, defaults: { video: "veo3_1" } });
    const model = effectiveMediaModel(cfg, "video");
    expect(model?.recommended).toBe(true);
    expect(model?.id).not.toBe("veo3_1");
  });

  it("honors a valid override when autoPick is off", () => {
    const cfg = parseMediaConfig({ autoPick: false, defaults: { video: "veo3_1" } });
    expect(effectiveMediaModel(cfg, "video")?.id).toBe("veo3_1");
  });

  it("falls back to recommended when the override is auto and autoPick is off", () => {
    const cfg = parseMediaConfig({ autoPick: false, defaults: { image: MEDIA_AUTO } });
    expect(effectiveMediaModel(cfg, "image")?.recommended).toBe(true);
  });
});

describe("resolveMediaDefaults", () => {
  it("resolves every offered category and marks auto-picks non-explicit", () => {
    const resolved = resolveMediaDefaults(DEFAULT_MEDIA_CONFIG);
    expect(Object.keys(resolved).sort()).toEqual(["audio", "image", "video"]);
    expect(resolved.image?.explicit).toBe(false);
    expect(resolved.image?.id).toBeTruthy();
  });

  it("marks a locked override as explicit", () => {
    const cfg = parseMediaConfig({ autoPick: false, defaults: { video: "veo3_1" } });
    const resolved = resolveMediaDefaults(cfg);
    expect(resolved.video).toMatchObject({ id: "veo3_1", explicit: true });
  });
});
