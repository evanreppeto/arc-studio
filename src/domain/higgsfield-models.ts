/**
 * Pure catalog of the Higgsfield models Arc can generate with, grouped by output
 * category. Backs the categorized model selector (operator override) and Arc's
 * per-category auto-pick (`recommended` — exactly one per offered category). No I/O.
 *
 * ⚠️ HAND-MAINTAINED, and it HAS drifted. Checked 2026-08-07 against the live
 * catalog (85 models): three ids here did not exist upstream — `recraft-v4-1`
 * (upstream uses underscores), `seedance_1_5` (upstream `seedance1_5`) and
 * `gpt_image` (no such model). Each was a pick that fails AFTER the customer is
 * charged. A typo in a hardcoded list is unfalsifiable from inside: the list is
 * self-consistent and every test reading it passes.
 *
 * So it is now checked against a snapshot of the real catalog —
 * `__fixtures__/higgsfield-catalog.json`, asserted by
 * `__tests__/higgsfield-roster-drift.test.ts`. Editing this file without the
 * snapshot agreeing fails CI, and an upstream model that is neither offered nor
 * explicitly excluded fails too, so a new one is a decision rather than a
 * silence. To refresh: re-run `models_explore(action:"list", limit:100)` and
 * rewrite the fixture.
 *
 * Validated 2026-06-24 against the live Higgsfield MCP `list_models` (59 models).
 * Image / video / audio ids below are confirmed from that dump. 3D and the extra
 * TTS voices (Cozy / ElevenLabs / Minimax / Seed Speech / Vibe) are NOT yet offered
 * because their exact ids weren't in the dump — reconcile them from a fresh
 * `list_models` call before adding, rather than guessing ids that would 404.
 */

export type HiggsfieldCategory = "image" | "video" | "audio" | "3d";

/** Categories Arc actively offers today. "3d" exists in the type for when its ids
 *  are reconciled, but it is not offered yet (see file header). */
export const HIGGSFIELD_CATEGORIES = ["image", "video", "audio"] as const;

export type HiggsfieldModel = {
  /** The model id passed to Higgsfield generation tools. */
  id: string;
  label: string;
  provider: string;
  category: HiggsfieldCategory;
  /** Arc's default pick for this category. Exactly one model per offered category. */
  recommended?: boolean;
};

export const HIGGSFIELD_MODELS: HiggsfieldModel[] = [
  // ---- Image (Marketing Studio Image is Arc's default — purpose-built for ads) ----
  { id: "marketing_studio_image", label: "Marketing Studio Image", provider: "Higgsfield", category: "image", recommended: true },
  { id: "ms_image", label: "DTC Ads", provider: "Higgsfield", category: "image" },
  { id: "soul_v2", label: "Higgsfield Soul 2.0", provider: "Higgsfield", category: "image" },
  { id: "soul_cast", label: "Soul Cast", provider: "Higgsfield", category: "image" },
  { id: "soul_cinematic", label: "Soul Cinema", provider: "Higgsfield", category: "image" },
  { id: "soul_location", label: "Soul Location", provider: "Higgsfield", category: "image" },
  { id: "cinematic_studio_2_5", label: "Cinema Studio Image 2.5", provider: "Higgsfield", category: "image" },
  { id: "image_auto", label: "Auto", provider: "Higgsfield", category: "image" },
  { id: "autosprite", label: "AutoSprite Animation", provider: "Higgsfield", category: "image" },
  { id: "flux_2", label: "Flux 2.0", provider: "Black Forest Labs", category: "image" },
  { id: "flux_kontext", label: "Flux Kontext Max", provider: "Black Forest Labs", category: "image" },
  { id: "gpt_image_2", label: "GPT Image 2", provider: "OpenAI", category: "image" },
  { id: "grok_image", label: "Grok Imagine", provider: "xAI", category: "image" },
  { id: "nano_banana", label: "Nano Banana", provider: "Google", category: "image" },
  { id: "nano_banana_2", label: "Nano Banana 2", provider: "Google", category: "image" },
  { id: "nano_banana_pro", label: "Nano Banana Pro", provider: "Google", category: "image" },
  { id: "kling_omni_image", label: "Kling O1 Image", provider: "Kling", category: "image" },
  { id: "recraft_v4_1", label: "Recraft 4.1", provider: "Recraft", category: "image" },
  { id: "seedream_v4_5", label: "Seedream 4.5", provider: "Bytedance", category: "image" },
  { id: "seedream_v5_lite", label: "Seedream 5.0 Lite", provider: "Bytedance", category: "image" },
  { id: "z_image", label: "Z Image", provider: "Tongyi-MAI", category: "image" },

  // ---- Video (Marketing Studio is Arc's default — purpose-built for ads) ----
  { id: "marketing_studio_video", label: "Marketing Studio", provider: "Higgsfield", category: "video", recommended: true },
  { id: "cinematic_studio_video", label: "Cinema Studio Video", provider: "Higgsfield", category: "video" },
  { id: "cinematic_studio_3_0", label: "Cinema Studio Video 3.0", provider: "Higgsfield", category: "video" },
  { id: "higgsfield_preset", label: "Higgsfield Preset", provider: "Higgsfield", category: "video" },
  { id: "clipify", label: "Personal Clipper", provider: "Higgsfield", category: "video" },
  { id: "veo3", label: "Google Veo 3", provider: "Google", category: "video" },
  { id: "veo3_1", label: "Google Veo 3.1", provider: "Google", category: "video" },
  { id: "veo3_1_lite", label: "Google Veo 3.1 Lite", provider: "Google", category: "video" },
  { id: "grok_video", label: "Grok Imagine", provider: "xAI", category: "video" },
  { id: "grok_video_v15", label: "Grok Imagine 1.5", provider: "xAI", category: "video" },
  { id: "kling2_6", label: "Kling 2.6", provider: "Kling", category: "video" },
  { id: "kling3_0", label: "Kling 3.0", provider: "Kling", category: "video" },
  { id: "kling3_0_turbo", label: "Kling 3.0 Turbo", provider: "Kling", category: "video" },
  { id: "seedance1_5", label: "Seedance 1.5 Pro", provider: "Bytedance", category: "video" },
  { id: "seedance_2_0", label: "Seedance 2.0", provider: "Bytedance", category: "video" },
  { id: "seedance_2_0_mini", label: "Seedance 2.0 Mini", provider: "Bytedance", category: "video" },
  { id: "minimax_hailuo", label: "Minimax Hailuo", provider: "Hailuo", category: "video" },
  { id: "wan2_6", label: "Wan 2.6", provider: "Wan", category: "video" },
  { id: "wan2_7", label: "Wan 2.7", provider: "Wan", category: "video" },

  // ---- Audio (Inworld TTS is Arc's default — voiceover) ----
  { id: "inworld_text_to_speech", label: "Inworld TTS", provider: "Inworld", category: "audio", recommended: true },
  { id: "mirelo_text_to_audio", label: "Mirelo SFX", provider: "Mirelo", category: "audio" },
  { id: "sonilo_music", label: "Sonilo Text-to-Music", provider: "Sonilo", category: "audio" },
];

/** All models in a category, in catalog order (recommended-first by construction). */
export function higgsfieldModelsByCategory(category: HiggsfieldCategory): HiggsfieldModel[] {
  return HIGGSFIELD_MODELS.filter((m) => m.category === category);
}

/** Resolve a model by its Higgsfield id, or null if it isn't in the roster. */
export function findHiggsfieldModel(id: string): HiggsfieldModel | null {
  return HIGGSFIELD_MODELS.find((m) => m.id === id) ?? null;
}

/** Arc's auto-pick for a category: the single `recommended` model, or null. */
export function defaultHiggsfieldModel(category: HiggsfieldCategory): HiggsfieldModel | null {
  return HIGGSFIELD_MODELS.find((m) => m.category === category && m.recommended) ?? null;
}

/**
 * The model to generate with for a category: the operator's `overrideId` when it
 * names a real model in that same category, otherwise Arc's recommended default.
 * A blank, unknown, or wrong-category override is ignored (auto-pick wins).
 */
export function resolveHiggsfieldModel(
  category: HiggsfieldCategory,
  overrideId?: string | null,
): HiggsfieldModel | null {
  const chosen = overrideId?.trim() ? findHiggsfieldModel(overrideId.trim()) : null;
  if (chosen && chosen.category === category) return chosen;
  return defaultHiggsfieldModel(category);
}
