import { describe, expect, it } from "vitest";

import { DEFAULT_MEDIA_CONFIG, MEDIA_AUTO, parseMediaConfig } from "../media-config";
import {
  GENERATION_MODELS,
  type EngineAvailability,
  describeTarget,
  findGenerationModel,
  geminiModelForTarget,
  geminiModelIds,
  generationModelsFor,
  resolveGenerationTarget,
} from "../media-target";

const BOTH: EngineAvailability = { gemini: true, higgsfield: true };
const GEMINI_ONLY: EngineAvailability = { gemini: true, higgsfield: false };

/** A config with a per-category pick, autoPick off (the shape a locked default has). */
function locked(defaults: Partial<Record<"image" | "video" | "audio", string>>) {
  return parseMediaConfig({ ...DEFAULT_MEDIA_CONFIG, autoPick: false, defaults: { ...DEFAULT_MEDIA_CONFIG.defaults, ...defaults } });
}

describe("the roster", () => {
  it("gives every model a unique engine-qualified key", () => {
    const keys = GENERATION_MODELS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries exactly one recommended model per engine + category", () => {
    const seen = new Map<string, number>();
    for (const m of GENERATION_MODELS.filter((m) => m.recommended)) {
      const bucket = `${m.engine}:${m.category}`;
      seen.set(bucket, (seen.get(bucket) ?? 0) + 1);
    }
    for (const [bucket, count] of seen) expect(`${bucket}=${count}`).toBe(`${bucket}=1`);
  });

  it("exposes the Gemini ids the settings allow-list is built from", () => {
    expect(geminiModelIds("image")).toContain("gemini-3-pro-image");
    expect(geminiModelIds("video")).toContain("veo-3.1-generate-preview");
    // Gemini has no audio model — the allow-list must not invent one.
    expect(geminiModelIds("audio")).toEqual([]);
  });
});

describe("findGenerationModel", () => {
  it("resolves an engine-qualified key on either engine", () => {
    expect(findGenerationModel("gemini:gemini-3-pro-image")?.engine).toBe("gemini");
    expect(findGenerationModel("higgsfield:veo3_1")?.engine).toBe("higgsfield");
  });

  it("reads a bare id as Higgsfield — the pre-namespace stored shape", () => {
    const model = findGenerationModel("veo3_1");
    expect(model?.engine).toBe("higgsfield");
    expect(model?.key).toBe("higgsfield:veo3_1");
  });

  it("refuses to guess an engine for an unknown qualified key", () => {
    expect(findGenerationModel("gemini:veo3_1")).toBeNull();
    expect(findGenerationModel("openai:gpt_image")).toBeNull();
  });

  it("treats blank, auto, and junk as no pick rather than an error", () => {
    for (const raw of [undefined, null, "", "   ", MEDIA_AUTO, "nope"]) {
      expect(findGenerationModel(raw)).toBeNull();
    }
  });
});

describe("generationModelsFor", () => {
  it("hides an engine the workspace cannot reach", () => {
    const offered = generationModelsFor("image", GEMINI_ONLY);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((m) => m.engine === "gemini")).toBe(true);
  });

  it("offers both engines when both are connected", () => {
    const engines = new Set(generationModelsFor("image", BOTH).map((m) => m.engine));
    expect(engines).toEqual(new Set(["gemini", "higgsfield"]));
  });
});

describe("resolveGenerationTarget precedence", () => {
  it("lets this request's pick beat the workspace default", () => {
    const target = resolveGenerationTarget({
      category: "video",
      config: locked({ video: "higgsfield:veo3_1" }),
      requestOverride: "gemini:veo-3.1-generate-preview",
      engines: BOTH,
    });
    expect(target).toMatchObject({ engine: "gemini", modelId: "veo-3.1-generate-preview", source: "request", locked: true });
  });

  it("falls to the workspace default when the request picks nothing", () => {
    const target = resolveGenerationTarget({ category: "video", config: locked({ video: "higgsfield:veo3_1" }), engines: BOTH });
    expect(target).toMatchObject({ engine: "higgsfield", modelId: "veo3_1", source: "workspace", locked: true });
  });

  it("falls to the legacy Gemini setting when nothing newer picked", () => {
    const target = resolveGenerationTarget({
      category: "image",
      config: locked({}),
      engines: BOTH,
      legacyGemini: { image: "gemini-3-pro-image" },
    });
    expect(target).toMatchObject({ engine: "gemini", modelId: "gemini-3-pro-image", source: "legacy", locked: true });
  });

  it("auto-picks when nothing is chosen, and does NOT report it as locked", () => {
    const target = resolveGenerationTarget({ category: "image", config: DEFAULT_MEDIA_CONFIG, engines: BOTH, autoEngine: "gemini" });
    expect(target?.source).toBe("auto");
    expect(target?.locked).toBe(false);
  });

  it("honours autoPick by suppressing BOTH stored layers, not just the newer one", () => {
    const config = parseMediaConfig({ autoPick: true, defaults: { video: "higgsfield:veo3_1" } });
    const target = resolveGenerationTarget({
      category: "video",
      config,
      engines: BOTH,
      legacyGemini: { video: "veo-3.1-generate-preview" },
      autoEngine: "gemini",
    });
    expect(target?.source).toBe("auto");
  });
});

describe("resolveGenerationTarget availability", () => {
  it("ignores a pick on an engine the workspace cannot reach", () => {
    // The failure this prevents: Higgsfield disconnected, its model still stored,
    // and generation silently attempted against an engine that isn't there.
    const target = resolveGenerationTarget({
      category: "video",
      config: locked({ video: "higgsfield:veo3_1" }),
      engines: GEMINI_ONLY,
      autoEngine: "gemini",
    });
    expect(target?.engine).toBe("gemini");
    expect(target?.source).toBe("auto");
  });

  it("ignores a request pick from the wrong category", () => {
    const target = resolveGenerationTarget({
      category: "image",
      config: DEFAULT_MEDIA_CONFIG,
      requestOverride: "gemini:veo-3.1-generate-preview",
      engines: BOTH,
      autoEngine: "gemini",
    });
    expect(target?.category).toBe("image");
    expect(target?.source).toBe("auto");
  });

  it("returns null when a category has no reachable model at all", () => {
    // Gemini has no audio model, so audio with Higgsfield off has nothing to run.
    expect(resolveGenerationTarget({ category: "audio", config: DEFAULT_MEDIA_CONFIG, engines: GEMINI_ONLY })).toBeNull();
  });

  it("falls back to the other engine when the preferred one has no model here", () => {
    const target = resolveGenerationTarget({ category: "audio", config: DEFAULT_MEDIA_CONFIG, engines: BOTH, autoEngine: "gemini" });
    expect(target?.engine).toBe("higgsfield");
  });
});

describe("geminiModelForTarget", () => {
  it("pins a locked Gemini model onto the wire", () => {
    const target = resolveGenerationTarget({ category: "image", config: locked({ image: "gemini:gemini-3-pro-image" }), engines: BOTH });
    expect(geminiModelForTarget(target)).toBe("gemini-3-pro-image");
  });

  it("leaves Gemini's own default chain alone for an auto target", () => {
    // This is what keeps "Auto" behaviour-identical to before the unification:
    // undefined means level → env → built-in default still runs untouched.
    const target = resolveGenerationTarget({ category: "image", config: DEFAULT_MEDIA_CONFIG, engines: BOTH, autoEngine: "gemini" });
    expect(geminiModelForTarget(target)).toBeUndefined();
  });

  it("never puts a Higgsfield id on a Gemini call", () => {
    const target = resolveGenerationTarget({ category: "video", config: locked({ video: "higgsfield:veo3_1" }), engines: BOTH });
    expect(target?.engine).toBe("higgsfield");
    expect(geminiModelForTarget(target)).toBeUndefined();
  });
});

describe("describeTarget", () => {
  it("records the engine, model, and what chose it", () => {
    const target = resolveGenerationTarget({ category: "image", config: locked({ image: "higgsfield:soul_v2" }), engines: BOTH });
    expect(describeTarget(target)).toEqual({ engine: "higgsfield", model: "soul_v2", modelLabel: "Higgsfield Soul 2.0", picked: "workspace" });
  });

  it("is null for no target", () => {
    expect(describeTarget(null)).toBeNull();
  });
});
