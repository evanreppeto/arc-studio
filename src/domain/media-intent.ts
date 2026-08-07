// Choosing a model by the JOB rather than by its name.
//
// The model control asks an owner-operator to pick between `soul_cinematic` and
// `seedream_v4_5`. That is Higgsfield's vocabulary, not a contractor's, and the
// difference is unanswerable without having tried both. What they DO have an
// opinion about is how the result should look.
//
// So this maps an intent onto candidates using the capability tags the upstream
// catalog already publishes — derived, not hand-mapped. A new upstream model
// with the right tags becomes reachable with no code change here, which is the
// property the hand-typed roster never had (it shipped three ids that did not
// exist).
//
// Pure. No I/O, no roster mutation, deterministic ordering.

import { type MediaCategory } from "./media-config";
import { GENERATION_MODELS, type EngineAvailability, type GenerationModel } from "./media-target";

/**
 * What the operator wants it to look like.
 *
 * Deliberately abstract rather than industry-flavoured: "product shot" means
 * something different to a shop than to a contractor, and per the universality
 * rule an industry-specific noun would have to come from the industry template.
 * These five are recognisable in any vertical.
 */
export const MEDIA_LOOKS = ["photoreal", "cinematic", "illustrated", "product", "social"] as const;
export type MediaLook = (typeof MEDIA_LOOKS)[number];

/**
 * Which way to lean when several models fit.
 *
 * ⚠️ NOT price. The catalog publishes no cost field — cost is only knowable
 * per-request via `get_cost` — so these rank on the catalog's own speed/quality
 * tags, which are a PROXY. `fast` finds models that call themselves fast; it
 * does not promise the cheapest. Ranking on real price needs a preflight per
 * candidate, which is a network call this function deliberately does not make.
 */
export const MEDIA_PRIORITIES = ["balanced", "fast", "best"] as const;
export type MediaPriority = (typeof MEDIA_PRIORITIES)[number];

/** Look → the upstream tags that satisfy it. Several, because vendors disagree. */
const LOOK_TAGS: Record<MediaLook, readonly string[]> = {
  photoreal: ["photorealistic", "ultra-realistic", "realistic", "natural"],
  cinematic: ["cinematic", "dramatic", "film", "camera-motion", "lighting"],
  illustrated: ["illustration", "stylized", "artistic", "concept-art", "vector", "sprite"],
  product: ["product", "e-commerce", "dtc", "mockups", "multi-sku", "ads", "marketing"],
  social: ["social-media", "ugc", "reels", "shorts", "tiktok", "viral", "youtube"],
};

const PRIORITY_TAGS: Record<MediaPriority, readonly string[]> = {
  balanced: ["versatile", "reliable", "quality"],
  fast: ["fast", "turbo", "quick", "lite", "budget", "affordable", "preview"],
  best: ["best-quality", "top-tier", "sota", "premium", "pro", "high-quality", "ultra", "4k"],
};

/** Tags meaning "this model can start from a picture you already have". */
const FROM_EXISTING_TAGS = ["start-frame", "image-to-video", "image-to-image", "editing", "instruction", "reference"];

export type IntentQuery = {
  category: MediaCategory;
  look?: MediaLook | null;
  priority?: MediaPriority;
  /**
   * True when the job acts on a picture the operator already has — animating a
   * still, or editing one. A model with no such capability cannot do it at all,
   * so this is a FILTER, not a preference: offering one would produce a
   * generation that silently ignores the very thing they pointed at.
   */
  fromExistingMedia?: boolean;
  engines: EngineAvailability;
};

export type IntentCandidate = {
  model: GenerationModel;
  score: number;
  /** The tags that earned it, in order. This is the "why" — a derived pick that
   *  cannot explain itself is indistinguishable from a random one, and the tags
   *  are the vendor's, so we will want to see when they mislead. */
  matched: readonly string[];
};

const LOOK_POINTS = 4;
const PRIORITY_POINTS = 2;
const RECOMMENDED_POINTS = 1;

function tagsOf(model: GenerationModel): readonly string[] {
  return model.tags ?? [];
}

function hits(model: GenerationModel, wanted: readonly string[]): string[] {
  const have = new Set(tagsOf(model));
  return wanted.filter((t) => have.has(t));
}

/**
 * Candidates for an intent, best first.
 *
 * Returns EVERY model that could do the job, ranked — not just a winner —
 * because the caller needs the runner-up list to render an override, and
 * because a scored list is inspectable in a way a single answer is not.
 *
 * An empty result means nothing offered can do it (e.g. audio with Higgsfield
 * disconnected). That is a real answer and the caller must handle it; it is
 * never silently substituted with something from another category.
 */
export function rankIntentCandidates(query: IntentQuery): IntentCandidate[] {
  const { category, engines } = query;
  const priority = query.priority ?? "balanced";

  const eligible = GENERATION_MODELS.filter((m) => {
    if (m.category !== category) return false;
    if (!engines[m.engine]) return false;
    // Hard capability filter — see IntentQuery.fromExistingMedia.
    if (query.fromExistingMedia && hits(m, FROM_EXISTING_TAGS).length === 0) return false;
    return true;
  });

  const scored = eligible.map((model) => {
    const matched: string[] = [];
    let score = 0;

    if (query.look) {
      const lookHits = hits(model, LOOK_TAGS[query.look]);
      // Capped at one look's worth: a model tagged with four synonyms for the
      // same idea is not four times as suitable, it is just verbosely tagged.
      if (lookHits.length > 0) {
        score += LOOK_POINTS;
        matched.push(...lookHits);
      }
    }

    const priorityHits = hits(model, PRIORITY_TAGS[priority]);
    if (priorityHits.length > 0) {
      score += PRIORITY_POINTS;
      matched.push(...priorityHits);
    }

    if (model.recommended) score += RECOMMENDED_POINTS;

    return { model, score, matched };
  });

  // Deterministic: score, then recommended, then id. A picker whose order
  // varies between identical calls cannot be tested or reasoned about.
  return scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(Boolean(b.model.recommended)) - Number(Boolean(a.model.recommended)) ||
      a.model.id.localeCompare(b.model.id),
  );
}

/**
 * The single model an intent resolves to, or null when nothing can do the job.
 *
 * Thin on purpose: the ranking is the interesting part and the caller usually
 * wants the alternatives too.
 */
export function resolveIntent(query: IntentQuery): IntentCandidate | null {
  return rankIntentCandidates(query)[0] ?? null;
}
