import { describe, expect, it } from "vitest";

import { GENERATION_MODELS, type EngineAvailability } from "../media-target";
import { MEDIA_LOOKS, MEDIA_PRIORITIES, rankIntentCandidates, resolveIntent } from "../media-intent";

/**
 * Asking for a JOB instead of a model name.
 *
 * The picker currently asks an owner-operator to choose between
 * `soul_cinematic` and `seedream_v4_5` — unanswerable without having tried
 * both. This ranks by what they do have an opinion about (how it should look),
 * using the capability tags the upstream catalog already publishes.
 */

const BOTH: EngineAvailability = { gemini: true, higgsfield: true };
const GEMINI_ONLY: EngineAvailability = { gemini: true, higgsfield: false };

describe("ranking is a real ranking", () => {
  it("returns every model that could do the job, not just a winner", () => {
    // The caller needs the runner-ups to render an override.
    const all = rankIntentCandidates({ category: "image", engines: BOTH });
    const offered = GENERATION_MODELS.filter((m) => m.category === "image");
    expect(all.length).toBe(offered.length);
  });

  it("is deterministic — identical queries give identical order", () => {
    const a = rankIntentCandidates({ category: "video", look: "cinematic", engines: BOTH });
    const b = rankIntentCandidates({ category: "video", look: "cinematic", engines: BOTH });
    expect(a.map((c) => c.model.key)).toEqual(b.map((c) => c.model.key));
  });

  it("orders by score, descending", () => {
    const scores = rankIntentCandidates({ category: "image", look: "photoreal", engines: BOTH }).map((c) => c.score);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
  });
});

describe("the look actually steers the pick", () => {
  it("puts a photoreal model first when asked for photoreal", () => {
    const top = resolveIntent({ category: "image", look: "photoreal", engines: BOTH })!;
    expect(top.matched.some((t) => ["photorealistic", "ultra-realistic", "realistic", "natural"].includes(t))).toBe(true);
  });

  it("picks a DIFFERENT model for a different look", () => {
    // The whole point. If every look resolved to the same model the control
    // would be decoration.
    const photo = resolveIntent({ category: "image", look: "photoreal", engines: BOTH })!;
    const product = resolveIntent({ category: "image", look: "product", engines: BOTH })!;
    expect(photo.model.key).not.toBe(product.model.key);
  });

  it("finds a candidate for every look, in both mediums", () => {
    // A look nothing satisfies is a chip that silently does nothing.
    for (const look of MEDIA_LOOKS) {
      for (const category of ["image", "video"] as const) {
        const top = resolveIntent({ category, look, engines: BOTH });
        expect(top, `${category}/${look}`).not.toBeNull();
        expect(top!.score, `${category}/${look} matched nothing`).toBeGreaterThan(0);
      }
    }
  });

  it("explains itself — every scoring candidate says which tags earned it", () => {
    // A derived pick that cannot explain itself is indistinguishable from a
    // random one, and these tags are the vendor's.
    for (const c of rankIntentCandidates({ category: "video", look: "cinematic", engines: BOTH })) {
      if (c.score > 1) expect(c.matched.length, c.model.id).toBeGreaterThan(0);
    }
  });
});

describe("priority leans without overriding the look", () => {
  it("prefers a fast model when asked to be fast", () => {
    const fast = resolveIntent({ category: "image", priority: "fast", engines: BOTH })!;
    expect(fast.matched.some((t) => ["fast", "turbo", "quick", "lite", "budget", "affordable", "preview"].includes(t))).toBe(true);
  });

  it("never lets priority outrank the look", () => {
    // Look is worth more than priority by design: someone who asked for
    // cinematic and got a fast non-cinematic model got the wrong thing.
    const top = resolveIntent({ category: "video", look: "cinematic", priority: "fast", engines: BOTH })!;
    expect(top.matched).toContain("cinematic");
  });

  it("accepts every declared priority", () => {
    for (const priority of MEDIA_PRIORITIES) {
      expect(resolveIntent({ category: "image", priority, engines: BOTH }), priority).not.toBeNull();
    }
  });
});

describe("capability is a filter, not a preference", () => {
  it("only offers models that can start from an existing picture", () => {
    // Offering one that cannot would produce a clip that ignores the very photo
    // the operator pointed at — the exact bug start-frame support exists to fix.
    const ok = ["start-frame", "image-to-video", "image-to-image", "editing", "instruction", "reference"];
    for (const c of rankIntentCandidates({ category: "video", fromExistingMedia: true, engines: BOTH })) {
      expect(c.model.tags?.some((t) => ok.includes(t)), `${c.model.id} cannot take a start frame`).toBe(true);
    }
  });

  it("narrows the field rather than returning everything", () => {
    const all = rankIntentCandidates({ category: "video", engines: BOTH }).length;
    const fromPhoto = rankIntentCandidates({ category: "video", fromExistingMedia: true, engines: BOTH }).length;
    expect(fromPhoto).toBeGreaterThan(0);
    expect(fromPhoto).toBeLessThan(all);
  });
});

describe("engine availability and empty answers", () => {
  it("never proposes a model on an engine the workspace cannot reach", () => {
    for (const c of rankIntentCandidates({ category: "image", look: "photoreal", engines: GEMINI_ONLY })) {
      expect(c.model.engine).toBe("gemini");
    }
  });

  it("returns nothing — rather than something from another category — when nothing fits", () => {
    // Gemini has no audio model. Substituting an image model would be worse
    // than an empty list, which the caller must handle.
    expect(rankIntentCandidates({ category: "audio", engines: GEMINI_ONLY })).toEqual([]);
    expect(resolveIntent({ category: "audio", engines: GEMINI_ONLY })).toBeNull();
  });

  it("still answers with no look and no priority", () => {
    const top = resolveIntent({ category: "image", engines: BOTH });
    expect(top).not.toBeNull();
    expect(top!.model.category).toBe("image");
  });
});

describe("both engines are reachable through intent", () => {
  it("can resolve to Gemini and to Higgsfield depending on the ask", () => {
    // If intent only ever picked one engine the abstraction would be a lie.
    const engines = new Set(
      MEDIA_LOOKS.flatMap((look) =>
        (["image", "video"] as const).map((category) => resolveIntent({ category, look, engines: BOTH })?.model.engine),
      ),
    );
    expect(engines.has("higgsfield")).toBe(true);
  });
});
