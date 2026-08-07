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
  /**
   * Capability tags, copied verbatim from the upstream catalog.
   *
   * This is what lets a caller ask for a JOB ("a photoreal still") instead of a
   * MODEL — see `media-intent.ts`. Copied rather than invented: the drift test
   * asserts these equal the catalog's, so a hand-edit here fails CI. Gemini
   * publishes no tags, so its five models are tagged by hand in `media-target.ts`
   * using this same vocabulary.
   */
  tags?: readonly string[];
};

export const HIGGSFIELD_MODELS: HiggsfieldModel[] = [
  // ---- Image (Marketing Studio Image is Arc's default — purpose-built for ads) ----
  { id: "marketing_studio_image", label: "Marketing Studio Image", provider: "Higgsfield", category: "image", recommended: true , tags: ["ads", "creative", "marketing", "product", "social-media"] },
  { id: "ms_image", label: "DTC Ads", provider: "Higgsfield", category: "image" , tags: ["ad-format", "ads", "avatar", "brand-kit", "dtc", "marketing", "product"] },
  { id: "soul_v2", label: "Higgsfield Soul 2.0", provider: "Higgsfield", category: "image" , tags: ["character", "character-generation", "editorial", "fashion", "portrait", "realistic", "soul", "ugc", "unlim", "v2"] },
  { id: "soul_cast", label: "Soul Cast", provider: "Higgsfield", category: "image" , tags: ["character", "cinematic", "consistent", "identity", "persona"] },
  { id: "soul_cinematic", label: "Soul Cinema", provider: "Higgsfield", category: "image" , tags: ["cinematic", "concept-art", "dramatic", "film", "lighting", "soul"] },
  { id: "soul_location", label: "Soul Location", provider: "Higgsfield", category: "image" , tags: ["background", "environment", "landscape", "location", "scene"] },
  { id: "cinematic_studio_2_5", label: "Cinema Studio Image 2.5", provider: "Higgsfield", category: "image" , tags: ["4k", "cinematic", "dramatic", "film", "high-resolution"] },
  { id: "image_auto", label: "Auto", provider: "Higgsfield", category: "image" , tags: ["auto", "editing", "generation", "routing", "smart"] },
  { id: "autosprite", label: "AutoSprite Animation", provider: "Higgsfield", category: "image" , tags: ["animation", "atlas", "character", "game", "image-to-animation", "pixel", "sprite", "spritesheet"] },
  { id: "flux_2", label: "Flux 2.0", provider: "Black Forest Labs", category: "image" , tags: ["creative", "precise", "pro", "prompt-adherence", "quality", "unlim", "versatile"] },
  { id: "flux_kontext", label: "Flux Kontext Max", provider: "Black Forest Labs", category: "image" , tags: ["context-aware", "editing", "remix", "style-transfer", "typography"] },
  { id: "gpt_image_2", label: "GPT Image 2", provider: "OpenAI", category: "image" , tags: ["4k", "editing", "high-resolution", "photorealistic", "text-rendering", "typography", "unlim"] },
  { id: "grok_image", label: "Grok Imagine", provider: "xAI", category: "image" , tags: ["bold", "creative", "editing", "expressive", "high-contrast"] },
  { id: "nano_banana", label: "Nano Banana", provider: "Google", category: "image" , tags: ["affordable", "budget", "image-to-image", "realistic", "text-to-image", "unlim"] },
  { id: "nano_banana_2", label: "Nano Banana 2", provider: "Google", category: "image" , tags: ["4k", "fast", "high-quality", "image-to-image", "photorealistic", "text-to-image", "unlim", "versatile"] },
  { id: "nano_banana_pro", label: "Nano Banana Pro", provider: "Google", category: "image" , tags: ["4k", "diagrams", "image-to-image", "photorealistic", "quality", "text-rendering", "text-to-image", "unlim", "versatile"] },
  { id: "kling_omni_image", label: "Kling O1 Image", provider: "Kling", category: "image" , tags: ["photorealistic", "realistic", "unlim", "versatile", "wide-aspect-ratio"] },
  { id: "recraft_v4_1", label: "Recraft 4.1", provider: "Recraft", category: "image" , tags: ["brand", "icons", "illustration", "logos", "mockups", "palette", "photorealistic", "product", "text-to-image", "typography", "utility", "vector"] },
  { id: "seedream_v4_5", label: "Seedream 4.5", provider: "Bytedance", category: "image" , tags: ["4k", "control", "editing", "high-resolution", "precise", "transformations", "unlim"] },
  { id: "seedream_v5_lite", label: "Seedream 5.0 Lite", provider: "Bytedance", category: "image" , tags: ["editing", "instruction", "reasoning", "smart", "unlim", "versatile"] },
  { id: "z_image", label: "Z Image", provider: "Tongyi-MAI", category: "image" , tags: ["budget", "fast", "quick", "stylized"] },

  // ---- Video (Marketing Studio is Arc's default — purpose-built for ads) ----
  { id: "marketing_studio_video", label: "Marketing Studio", provider: "Higgsfield", category: "video", recommended: true , tags: ["ads", "marketing", "product", "reels", "social-media", "tiktok", "ugc"] },
  { id: "cinematic_studio_video", label: "Cinema Studio Video", provider: "Higgsfield", category: "video" , tags: ["cinematic", "compositions", "dramatic", "slow-motion", "sound"] },
  { id: "cinematic_studio_3_0", label: "Cinema Studio Video 3.0", provider: "Higgsfield", category: "video" , tags: ["advanced", "best-quality", "cinematic", "film", "premium", "sota"] },
  { id: "higgsfield_preset", label: "Higgsfield Preset", provider: "Higgsfield", category: "video" , tags: ["image-to-video", "preset", "template", "viral"] },
  { id: "clipify", label: "Personal Clipper", provider: "Higgsfield", category: "video" , tags: ["clips", "personal-clipper", "reels", "shorts", "subtitles", "youtube"] },
  { id: "veo3", label: "Google Veo 3", provider: "Google", category: "video" , tags: ["audio", "cinematic", "creative", "image-to-video", "reliable"] },
  { id: "veo3_1", label: "Google Veo 3.1", provider: "Google", category: "video" , tags: ["audio", "cinematic", "quality", "top-tier", "ultra-realistic"] },
  { id: "veo3_1_lite", label: "Google Veo 3.1 Lite", provider: "Google", category: "video" , tags: ["affordable", "batch", "budget", "fast", "lite"] },
  { id: "grok_video", label: "Grok Imagine", provider: "xAI", category: "video" , tags: ["audio", "image-to-video", "text-to-video", "versatile"] },
  { id: "grok_video_v15", label: "Grok Imagine 1.5", provider: "xAI", category: "video" , tags: ["audio", "audio-reference", "camera-motion", "cinematic", "image-to-video", "physics", "preview", "reference", "start-frame", "text-to-video"] },
  { id: "kling2_6", label: "Kling 2.6", provider: "Kling", category: "video" , tags: ["advanced", "audio", "cinematic", "motion", "physics"] },
  { id: "kling3_0", label: "Kling 3.0", provider: "Kling", category: "video" , tags: ["advanced", "audio", "cinematic", "motion-transfer", "multi-shot", "unlim"] },
  { id: "kling3_0_turbo", label: "Kling 3.0 Turbo", provider: "Kling", category: "video" , tags: ["budget", "fast", "image-to-video", "kling", "start-frame", "text-to-video", "turbo"] },
  { id: "seedance1_5", label: "Seedance 1.5 Pro", provider: "Bytedance", category: "video" , tags: ["motion", "quality", "reliable", "versatile"] },
  { id: "seedance_2_0", label: "Seedance 2.0", provider: "Bytedance", category: "video" , tags: ["4k", "audio", "audio-reference", "consistent", "e-commerce", "end-frame", "high-resolution", "identity", "multi-sku", "product", "reference", "start-frame", "unlim", "video-reference"] },
  { id: "seedance_2_0_mini", label: "Seedance 2.0 Mini", provider: "Bytedance", category: "video" , tags: ["audio", "audio-reference", "budget", "consistent", "end-frame", "fast", "identity", "reference", "start-frame", "unlim", "video-reference"] },
  { id: "minimax_hailuo", label: "Minimax Hailuo", provider: "Hailuo", category: "video" , tags: ["1080p", "emotion", "facial", "natural", "physics", "realistic"] },
  { id: "wan2_6", label: "Wan 2.6", provider: "Wan", category: "video" , tags: ["artistic", "creative", "experimental", "open-weight", "stylized"] },
  { id: "wan2_7", label: "Wan 2.7", provider: "Wan", category: "video" , tags: ["audio", "character", "consistent", "sound", "sync", "unlim"] },

  // ---- Audio (Inworld TTS is Arc's default — voiceover) ----
  { id: "inworld_text_to_speech", label: "Inworld TTS", provider: "Inworld", category: "audio", recommended: true , tags: ["audio", "fal", "inworld", "speech", "text-to-speech", "tts", "unlim"] },
  { id: "mirelo_text_to_audio", label: "Mirelo SFX", provider: "Mirelo", category: "audio" , tags: ["audio", "fal", "mirelo", "sfx", "sound-effects", "text-to-audio", "unlim"] },
  { id: "sonilo_music", label: "Sonilo Text-to-Music", provider: "Sonilo", category: "audio" , tags: ["audio", "fal", "music", "sonilo", "text-to-music"] },
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
