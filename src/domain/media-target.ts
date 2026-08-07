// One model choice across BOTH generation engines. Pure, deterministic. No I/O.
//
// Before this module, "which model generates" was two disconnected settings over
// two rosters, and neither reached the wire:
//   - app_settings.image_model / video_model  → the Gemini roster, read by the
//     app-side generate-* routes.
//   - workspace_media_config.defaults         → the Higgsfield roster, injected
//     into Arc's prompt as prose.
// An operator could lock "Veo 3.1" in one and watch generation run on the other,
// with no error anywhere, because the two never met. This is where they meet:
// every surface resolves ONE `GenerationTarget` and the executor puts its
// `modelId` on the wire.
//
// Model ids are namespaced by engine (`gemini:...`, `higgsfield:...`) because the
// two rosters collide conceptually — both have a "Veo 3.1" — and a bare id can't
// say which engine is meant. A stored bare id is read as Higgsfield for
// back-compat with the pre-namespace `workspace_media_config` shape.

// Imports only ./higgsfield-models on purpose: media-config.ts imports
// findGenerationModel from HERE to validate a stored default, so the dependency
// has to run one way. The config is taken structurally for the same reason.
import { HIGGSFIELD_CATEGORIES, HIGGSFIELD_MODELS } from "./higgsfield-models";

/** The offered categories — the same type `media-config.ts` exports as
 *  `MediaCategory`, derived from the same source so the two unify. */
type MediaCategory = (typeof HIGGSFIELD_CATEGORIES)[number];

/** `media-config.ts`'s MEDIA_AUTO sentinel. Duplicated as a literal rather than
 *  imported, to keep this module free of a cycle; the type test below pins them
 *  together so a rename can't silently drift. */
const AUTO = "auto";

/** The two engines that can actually produce media for a workspace. */
export const MEDIA_ENGINES = ["gemini", "higgsfield"] as const;
export type MediaEngine = (typeof MEDIA_ENGINES)[number];

/** Which engines this workspace can currently reach. Higgsfield is credential-
 *  gated per workspace; Gemini is the built-in path. */
export type EngineAvailability = Record<MediaEngine, boolean>;

export type GenerationModel = {
  engine: MediaEngine;
  /** The engine-native id that goes on the wire. NOT unique across engines. */
  id: string;
  /** Stable, engine-qualified id — what a picker binds to and what we persist. */
  key: string;
  label: string;
  provider: string;
  category: MediaCategory;
  /** The engine's default pick for this category. Exactly one per engine+category. */
  recommended?: boolean;
  /** Capability tags — what `media-intent.ts` matches a job against. Higgsfield's
   *  come verbatim from its catalog; Gemini's are assigned below by hand. */
  tags?: readonly string[];
};

/**
 * The built-in Gemini/Veo roster. These ids were already live in three places
 * (`IMAGE_MODELS`/`VIDEO_MODELS` in the settings store, `levelMediaModels`, and
 * the provider's own defaults) with no shared list; this is now the one list and
 * the settings store derives its allow-list from it.
 *
 * `recommended` marks what Gemini's own chain lands on for an interactive turn —
 * it is informational, because an auto target deliberately leaves that chain
 * (level → env → built-in default) alone rather than pinning a model.
 */
//
// ⚠️ The `tags` here are ASSIGNED BY US, not published by Google — unlike the
// Higgsfield roster, whose tags are copied verbatim and drift-tested against the
// catalog. Nothing upstream will correct them if they are wrong, so they are
// conservative: only capabilities the model's own docs state. Two vocabularies
// meeting in one table is a real seam, and this is the side without a source of
// truth behind it.
const GEMINI_MODELS: Array<Omit<GenerationModel, "engine" | "key">> = [
  { id: "gemini-3-pro-image", label: "Gemini 3 Pro Image", provider: "Google", category: "image", tags: ["photorealistic", "high-quality", "4k", "versatile", "text-to-image", "image-to-image", "editing"] },
  { id: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image", provider: "Google", category: "image", recommended: true, tags: ["fast", "versatile", "text-to-image", "image-to-image", "editing"] },
  { id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image", provider: "Google", category: "image", tags: ["fast", "budget", "text-to-image", "image-to-image", "editing"] },
  { id: "veo-3.1-generate-preview", label: "Veo 3.1", provider: "Google", category: "video", tags: ["cinematic", "high-quality", "text-to-video", "image-to-video", "start-frame"] },
  { id: "veo-3.1-fast-generate-preview", label: "Veo 3.1 Fast", provider: "Google", category: "video", recommended: true, tags: ["fast", "text-to-video", "image-to-video", "start-frame"] },
];

function qualify(engine: MediaEngine, id: string): string {
  return `${engine}:${id}`;
}

/** Every model either engine can generate, in picker order (Gemini first — it is
 *  the engine the app itself executes; see the module header). */
export const GENERATION_MODELS: GenerationModel[] = [
  ...GEMINI_MODELS.map((m) => ({ ...m, engine: "gemini" as const, key: qualify("gemini", m.id) })),
  ...HIGGSFIELD_MODELS.map((m) => ({
    engine: "higgsfield" as const,
    id: m.id,
    key: qualify("higgsfield", m.id),
    label: m.label,
    provider: m.provider,
    category: m.category as MediaCategory,
    ...(m.recommended ? { recommended: true as const } : {}),
    ...(m.tags ? { tags: m.tags } : {}),
  })),
];

/** The Gemini ids, for the settings store's allow-list. Derived, not re-typed. */
export function geminiModelIds(category: MediaCategory): string[] {
  return GENERATION_MODELS.filter((m) => m.engine === "gemini" && m.category === category).map((m) => m.id);
}

/**
 * Resolve a stored/submitted model reference to a real model.
 *
 * Accepts an engine-qualified key (`"higgsfield:veo3_1"`) or a bare id, which is
 * read as Higgsfield — the shape `workspace_media_config` used before engines
 * were namespaced. `MEDIA_AUTO`, blank, and anything unknown resolve to null,
 * which every caller treats as "no pick", never as an error.
 */
export function findGenerationModel(value: string | null | undefined): GenerationModel | null {
  const raw = value?.trim();
  if (!raw || raw === AUTO) return null;
  const direct = GENERATION_MODELS.find((m) => m.key === raw);
  if (direct) return direct;
  if (raw.includes(":")) return null; // qualified but unknown — don't guess the engine
  return GENERATION_MODELS.find((m) => m.engine === "higgsfield" && m.id === raw) ?? null;
}

/** The models a picker should offer for a category, limited to reachable engines. */
export function generationModelsFor(category: MediaCategory, engines: EngineAvailability): GenerationModel[] {
  return GENERATION_MODELS.filter((m) => m.category === category && engines[m.engine]);
}

export type GenerationTargetSource = "request" | "workspace" | "legacy" | "auto";

export type GenerationTarget = {
  engine: MediaEngine;
  /** The engine-native model id. On a locked target this goes on the wire. */
  modelId: string;
  /** Engine-qualified id — what the UI binds to. */
  key: string;
  label: string;
  provider: string;
  category: MediaCategory;
  /** Where the pick came from, most specific first. */
  source: GenerationTargetSource;
  /**
   * A human deliberately chose this model. ONLY a locked target is forced onto
   * the wire — an auto target leaves each engine's own default chain intact
   * (Gemini: level → env → built-in default), which is what "Auto" has always
   * meant here and what keeps this change behaviour-preserving by default.
   */
  locked: boolean;
};

export type ResolveGenerationTargetInput = {
  category: MediaCategory;
  /** The workspace's persisted per-category default (Layer 2). Structural so
   *  media-config.ts can depend on this module and not the reverse. */
  config: { defaults: Record<MediaCategory, string>; autoPick: boolean };
  /** This request's override — the composer picker. Beats every stored default. */
  requestOverride?: string | null;
  /** Which engines the workspace can reach. */
  engines: EngineAvailability;
  /**
   * The legacy per-org Gemini defaults (`app_settings.image_model` /
   * `video_model`). Kept in the precedence chain rather than deleted, so a
   * workspace that had set one kept its meaning when the two settings merged.
   */
  legacyGemini?: { image?: string | null; video?: string | null };
  /**
   * Which engine an auto pick lands on. Callers that can only execute one engine
   * pass their own (the app-side routes pass "gemini"); the runner passes the
   * engine it is describing. Falls back to any available engine.
   */
  autoEngine?: MediaEngine;
};

function recommendedFor(category: MediaCategory, engine: MediaEngine): GenerationModel | null {
  return GENERATION_MODELS.find((m) => m.category === category && m.engine === engine && m.recommended) ?? null;
}

function target(model: GenerationModel, source: GenerationTargetSource): GenerationTarget {
  return {
    engine: model.engine,
    modelId: model.id,
    key: model.key,
    label: model.label,
    provider: model.provider,
    category: model.category,
    source,
    locked: source !== "auto",
  };
}

/** A pick counts only if it's a real model, in the asked-for category, on an
 *  engine this workspace can actually reach. Anything else falls through. */
function usable(model: GenerationModel | null, category: MediaCategory, engines: EngineAvailability): GenerationModel | null {
  return model && model.category === category && engines[model.engine] ? model : null;
}

/**
 * The single resolution every generation surface runs. Precedence, most specific
 * first: this request's pick → the workspace default → the legacy Gemini default
 * → auto. Returns null only when the category has no reachable model at all
 * (e.g. audio with Higgsfield disconnected — Gemini has no audio model).
 */
export function resolveGenerationTarget(input: ResolveGenerationTargetInput): GenerationTarget | null {
  const { category, config, engines } = input;

  const requested = usable(findGenerationModel(input.requestOverride), category, engines);
  if (requested) return target(requested, "request");

  // autoPick is the operator saying "ignore my stored defaults" — it suppresses
  // the workspace and legacy layers, not just the workspace one.
  if (!config.autoPick) {
    const stored = usable(findGenerationModel(config.defaults[category]), category, engines);
    if (stored) return target(stored, "workspace");

    const legacyId = category === "image" ? input.legacyGemini?.image : category === "video" ? input.legacyGemini?.video : null;
    const legacy = usable(findGenerationModel(legacyId ? qualify("gemini", legacyId) : null), category, engines);
    if (legacy) return target(legacy, "legacy");
  }

  const preferred = input.autoEngine && engines[input.autoEngine] ? recommendedFor(category, input.autoEngine) : null;
  if (preferred) return target(preferred, "auto");
  for (const engine of MEDIA_ENGINES) {
    if (!engines[engine]) continue;
    const fallback = recommendedFor(category, engine);
    if (fallback) return target(fallback, "auto");
  }
  return null;
}

/**
 * The Gemini model id to put on the wire, or undefined to leave Gemini's own
 * default chain alone. The app-side executors call this instead of reading a
 * setting directly, so an operator pick is enforced as an argument rather than
 * hoped for. A Higgsfield target returns undefined here: the app cannot execute
 * Higgsfield (Arc does, through the MCP connector), so pinning its id onto a
 * Gemini call would send a model id the API has never heard of.
 */
export function geminiModelForTarget(target: GenerationTarget | null): string | undefined {
  if (!target || !target.locked || target.engine !== "gemini") return undefined;
  return target.modelId;
}

/**
 * A model pick, resolved for a consumer that cannot import this roster — today
 * the Cloud Run runner, a separate package. It receives a resolved record and
 * relays `key` back to the media endpoints, which validate it again on the way
 * in. Handing it a raw id to interpret is how the two rosters drifted apart.
 */
export type MediaPick = {
  /** Engine-qualified key — what the media endpoints re-resolve. */
  key: string;
  engine: MediaEngine;
  /** Engine-native id — the value of Higgsfield's REQUIRED `model` argument. */
  id: string;
  category: MediaCategory;
  label: string;
};

/** Resolve a stored/submitted key to a pick, or null for Auto and for anything
 *  that no longer names a real model. */
export function resolveMediaPick(value: string | null | undefined): MediaPick | null {
  const model = findGenerationModel(value);
  if (!model) return null;
  return { key: model.key, engine: model.engine, id: model.id, category: model.category, label: model.label };
}

/** Provenance for a generated asset: what actually chose the model, in a shape
 *  that survives into `media_assets`/`campaign_assets` metadata. */
export function describeTarget(target: GenerationTarget | null): { engine: string; model: string; modelLabel: string; picked: GenerationTargetSource } | null {
  if (!target) return null;
  return { engine: target.engine, model: target.modelId, modelLabel: target.label, picked: target.source };
}
