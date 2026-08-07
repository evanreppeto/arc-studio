import { describe, expect, it } from "vitest";

import { GENERATION_MODELS, type EngineAvailability } from "../media-target";
import { MEDIA_LOOKS, MEDIA_PRIORITIES, choiceToModelKey, rankIntentCandidates, resolveIntent } from "../media-intent";

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

describe("choiceToModelKey — capability belongs to the action", () => {
  const intent = { kind: "intent" as const, look: "cinematic" as const, priority: "balanced" as const };

  it("passes an exact pick straight through, including Auto", () => {
    expect(choiceToModelKey({ kind: "exact", key: "higgsfield:veo3_1" }, { category: "video", engines: BOTH })).toBe("higgsfield:veo3_1");
    expect(choiceToModelKey({ kind: "exact", key: "auto" }, { category: "video", engines: BOTH })).toBe("auto");
  });

  it("lets one taste resolve differently per action — the filter is not inert", () => {
    // The bug this shape exists to prevent. One Studio control feeds both
    // "generate a scene from words" and "edit this photo"; resolving once for
    // both would hand the edit a model that cannot take a reference — which
    // renders something unrelated and bills for it.
    //
    // Asserted across looks, not on one: a look whose top model happens to
    // accept a start frame anyway is SUPPOSED to resolve the same both ways.
    // What must not happen is the requirement never mattering at all.
    const steered = MEDIA_LOOKS.filter((look) => {
      const taste = { kind: "intent" as const, look, priority: "balanced" as const };
      return (
        choiceToModelKey(taste, { category: "video", engines: BOTH }) !==
        choiceToModelKey(taste, { category: "video", engines: BOTH, fromExistingMedia: true })
      );
    });
    expect(steered.length, "no look changes model when a start frame is required — filter is doing nothing").toBeGreaterThan(0);
  });

  it("only ever returns a model that can take a reference when one is required", () => {
    const key = choiceToModelKey(intent, { category: "video", engines: BOTH, fromExistingMedia: true });
    const model = GENERATION_MODELS.find((m) => m.key === key)!;
    const ok = ["start-frame", "image-to-video", "image-to-image", "editing", "instruction", "reference"];
    expect(model.tags?.some((t) => ok.includes(t))).toBe(true);
  });

  it("falls back to Auto rather than returning nothing", () => {
    // A control that resolved to no model would fail at submit instead of here.
    expect(choiceToModelKey(intent, { category: "audio", engines: GEMINI_ONLY })).toBe("auto");
  });
});

describe("the ordering does not let an arbitrary tiebreak decide", () => {
  it("resolves Illustrated to an illustration model, not a game sprite tool", () => {
    // Caught in the browser, not by a test: "Illustrated" resolved to
    // `autosprite` (a spritesheet animator, 1 matching tag) over `recraft_v4_1`
    // (vector illustration, 2 matching tags) because the score cap tied them and
    // `id.localeCompare` broke the tie alphabetically. An owner-operator asking
    // for an illustrated ad would have been billed for a character sheet.
    const top = resolveIntent({ category: "image", look: "illustrated", engines: BOTH })!;
    expect(top.model.id).not.toBe("autosprite");
    expect(top.model.tags ?? []).toContain("illustration");
  });

  it("prefers the model that matches MORE of the look's vocabulary", () => {
    // The general rule behind that fix. The cap on score is still right; breadth
    // only decides among models the cap has already tied.
    const ranked = rankIntentCandidates({ category: "image", look: "illustrated", engines: BOTH });
    const top = ranked[0]!;
    const tiedWithTop = ranked.filter((c) => c.score === top.score);
    for (const c of tiedWithTop) expect(top.matched.length).toBeGreaterThanOrEqual(c.matched.length);
  });

  it("keeps a spritesheet animator out of the illustrated look entirely", () => {
    // It is a different MEDIUM, not a style — the same category error as
    // offering an upscaler as a generator.
    const ranked = rankIntentCandidates({ category: "image", look: "illustrated", engines: BOTH });
    const sprite = ranked.find((c) => c.model.id === "autosprite");
    expect(sprite?.matched ?? []).not.toContain("sprite");
  });
});
