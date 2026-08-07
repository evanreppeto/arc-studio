import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { HIGGSFIELD_MODELS } from "../higgsfield-models";

/**
 * The roster was hand-typed from a `list_models` dump and drifted, invisibly.
 *
 * Found 2026-08-07: three of its ids did not exist upstream — `recraft-v4-1`
 * (hyphens, upstream uses underscores), `seedance_1_5` (upstream: `seedance1_5`)
 * and `gpt_image` (no such model at all). Each was a live landmine: pick it in
 * the model control and the generation fails AFTER the customer is charged, with
 * a "model not found" they cannot act on.
 *
 * A transcription slip in a hardcoded list is unfalsifiable by unit tests — the
 * list is self-consistent and every test that reads it passes. Only comparing it
 * to the SOURCE catches it, which is what the snapshot is for.
 *
 * Refresh: re-run the Higgsfield MCP `models_explore(action:"list", limit:100)`
 * and write `{captured_at, source, count, models:[{id,type,name,provider,tags}]}`
 * to the fixture. It is a snapshot, not a live call: CI has no Higgsfield
 * credential, and a test that needs the network is a test that goes flaky and
 * then gets skipped.
 */

type CatalogModel = { id: string; type: string; name: string; provider: string; tags?: string[] };
const catalog = JSON.parse(
  readFileSync(new URL("../__fixtures__/higgsfield-catalog.json", import.meta.url), "utf8"),
) as { captured_at: string; count: number; models: CatalogModel[] };

const live = new Map(catalog.models.map((m) => [m.id, m]));

/**
 * Live models we deliberately do NOT offer as generators, each with the reason.
 *
 * The classification matters more than the list. Two different things are in
 * here, and only one of them is a "model" in the sense the picker means:
 *
 *  - OPERATIONS act on media that already exists (upscale, cut out, extend,
 *    stabilise). They belong on an asset as a verb — "Upscale this" — not in a
 *    "which model should generate this?" dropdown. Offering them there is a
 *    category error that would produce a generation with nothing to act on.
 *  - NOT TRIAGED are real generators nobody has decided about yet. Listing them
 *    here is the decision being deferred out loud, instead of the roster quietly
 *    being 27 models short.
 */
const NOT_OFFERED: Record<string, string> = {
  // Operations, not generators.
  bytedance_image_upscale: "operation: upscales an existing image",
  bytedance_video_upscale: "operation: upscales an existing video",
  image_background_remover: "operation: cuts out an existing image",
  video_background_remover: "operation: cuts out an existing video",
  outpaint: "operation: extends an existing image",
  topaz_image: "operation: enhances an existing image",
  topaz_image_generative: "operation: enhances an existing image",
  topaz_video: "operation: enhances an existing video",
  video_upscale: "operation: upscales an existing video",
  video_deflicker: "operation: stabilises an existing video",
  sam_3_video: "operation: segments an existing video",
  sync_so: "operation: lip-syncs an existing video",

  // Real generators, not yet triaged into the roster.
  nano_banana_2_lite: "not triaged",
  nano_banana_2_shots: "not triaged",
  openai_hazel: "not triaged",
  seedream_v5_pro: "not triaged",
  soul_2: "not triaged",
  cinematic_studio_video_v2: "not triaged",
  flux_3_video: "not triaged",
  gemini_omni: "not triaged",
  happy_horse_video: "not triaged",
  minimax_h3: "not triaged",
  seedance_2_5: "not triaged",
  llm_text: "not triaged",
  qwen_audio_tts: "not triaged",
  seed_audio: "not triaged",
  text2speech_v2: "not triaged",
};

describe("the roster matches the upstream catalog", () => {
  it("has a snapshot to compare against", () => {
    // Guards the guard: an empty or unparsed fixture would make every assertion
    // below vacuously true.
    expect(catalog.count).toBeGreaterThan(50);
    expect(catalog.models.length).toBe(catalog.count);
  });

  it("offers no model id that does not exist upstream", () => {
    // THE bug. Three ids failed this on the day it was written.
    const missing = HIGGSFIELD_MODELS.filter((m) => !live.has(m.id)).map((m) => `${m.id} (${m.label})`);
    expect(missing, "roster ids with no upstream model — a pick that fails after billing").toEqual([]);
  });

  it("files every model under the category upstream gives it", () => {
    // A video model listed as an image would be offered in the wrong picker and
    // rejected at submit — the same failure, one layer later.
    const wrong = HIGGSFIELD_MODELS.filter((m) => live.get(m.id)!.type !== m.category).map(
      (m) => `${m.id}: ours=${m.category} upstream=${live.get(m.id)!.type}`,
    );
    expect(wrong).toEqual([]);
  });

  it("accounts for every upstream generator — offered, or excluded with a reason", () => {
    // Not a style rule. This is what makes a NEW upstream model a decision
    // instead of a silence: it fails until someone either lists it or says why
    // not. The roster was 27 models short and nothing said so.
    const offered = new Set(HIGGSFIELD_MODELS.map((m) => m.id));
    const unaccounted = catalog.models
      .filter((m) => m.type !== "3d" && !offered.has(m.id) && !(m.id in NOT_OFFERED))
      .map((m) => `${m.type}/${m.id} (${m.name})`);
    expect(
      unaccounted,
      "upstream models that are neither offered nor explained — add to HIGGSFIELD_MODELS, or to NOT_OFFERED with a reason",
    ).toEqual([]);
  });

  it("does not carry exclusions for models that no longer exist", () => {
    // Otherwise the exclusion list rots into a record of a catalog that is gone.
    const stale = Object.keys(NOT_OFFERED).filter((id) => !live.has(id));
    expect(stale, "NOT_OFFERED entries with no upstream model — delete them").toEqual([]);
  });

  it("carries the upstream tags verbatim", () => {
    // The tags are not decoration — `media-intent.ts` RANKS on them, so a
    // hand-edited tag is a hand-edited model pick. They were injected into the
    // roster by a script reading this same fixture, which means the only thing
    // standing between them and the ids' fate (three that did not exist, for
    // months) is this comparison.
    const drifted = HIGGSFIELD_MODELS.filter((m) => {
      const upstream = [...(live.get(m.id)?.tags ?? [])].sort();
      return JSON.stringify([...(m.tags ?? [])].sort()) !== JSON.stringify(upstream);
    }).map((m) => `${m.id}: ours=[${m.tags ?? []}] upstream=[${live.get(m.id)?.tags ?? []}]`);
    expect(drifted, "roster tags that disagree with the catalog — re-run the injection, don't hand-edit").toEqual([]);
  });

  it("leaves no offered model untagged", () => {
    // An untagged model scores zero against every look and every priority, so
    // intent can never surface it. It would still be in the raw dropdown —
    // present, and unreachable by the control anyone actually uses.
    const untagged = HIGGSFIELD_MODELS.filter((m) => !m.tags?.length).map((m) => `${m.id} (${m.label})`);
    expect(untagged, "offered models with no tags — intent can never rank these").toEqual([]);
  });

  it("keeps exactly one recommended model per offered category", () => {
    const byCategory = new Map<string, number>();
    for (const m of HIGGSFIELD_MODELS.filter((m) => m.recommended)) {
      byCategory.set(m.category, (byCategory.get(m.category) ?? 0) + 1);
    }
    for (const [category, n] of byCategory) expect(`${category}=${n}`).toBe(`${category}=1`);
  });
});
