import { type SupabaseClient } from "@supabase/supabase-js";

import {
  type EngineAvailability,
  type GenerationTarget,
  type MediaCategory,
  resolveGenerationTarget,
} from "@/domain";
import { listWorkspaceConnectors } from "@/lib/connectors/read-model";
import { resolveMediaGeneration } from "@/lib/media/enablement";
import { getAppSettings } from "@/lib/settings/store";

import { getWorkspaceMediaConfig } from "./read-model";

/**
 * I/O side of model selection: gather the four inputs the pure resolver needs
 * (workspace media config, legacy per-org Gemini defaults, engine availability,
 * this request's pick) and hand back ONE target.
 *
 * Every generation surface goes through here so the answer to "which model
 * generates" is computed once, from the same inputs, instead of each caller
 * reading whichever setting it happened to know about.
 */

/**
 * Which engines this workspace can actually reach right now. Gemini is the
 * built-in path (platform credits or the workspace's own key); Higgsfield is the
 * per-workspace connector, and only counts when it is fully connected — an
 * enabled-but-uncredentialed row cannot generate, and offering its models would
 * be a picker full of choices that fail on use.
 */
export async function resolveWorkspaceEngines(client: SupabaseClient, workspaceId: string | null): Promise<EngineAvailability> {
  if (!workspaceId) return { gemini: false, higgsfield: false };
  const [media, connectors] = await Promise.all([
    resolveMediaGeneration(workspaceId),
    listWorkspaceConnectors(client, workspaceId).catch(() => []),
  ]);
  return {
    gemini: media.enabled,
    higgsfield: connectors.some((c) => c.key === "higgsfield" && c.status === "connected"),
  };
}

export type WorkspaceTargetInput = {
  client: SupabaseClient;
  workspaceId: string | null;
  orgId: string | null;
  category: MediaCategory;
  /** This request's pick (composer picker), engine-qualified. Beats stored defaults. */
  requestOverride?: string | null;
  /** Pre-resolved availability, when the caller already computed it. */
  engines?: EngineAvailability;
};

/**
 * The generation target for one request. Never throws: a lookup failure resolves
 * to the auto target rather than blocking generation, because a model preference
 * going missing must not be able to stop an operator from generating at all.
 */
export async function resolveWorkspaceTarget(input: WorkspaceTargetInput): Promise<GenerationTarget | null> {
  const { client, workspaceId, orgId, category } = input;
  const [config, settings, engines] = await Promise.all([
    workspaceId ? getWorkspaceMediaConfig(client, workspaceId) : Promise.resolve(null),
    getAppSettings(orgId).catch(() => null),
    input.engines ? Promise.resolve(input.engines) : resolveWorkspaceEngines(client, workspaceId),
  ]);

  return resolveGenerationTarget({
    category,
    config: config ?? { defaults: { image: "auto", video: "auto", audio: "auto" }, autoPick: true },
    requestOverride: input.requestOverride,
    engines,
    legacyGemini: { image: settings?.imageModel, video: settings?.videoModel },
    // The app itself can only execute Gemini — Arc drives Higgsfield through its
    // MCP connector. So an *auto* target on an app-side path lands on Gemini and
    // leaves its default chain intact; Higgsfield is reached only by an explicit
    // pick, which the runner turns into a required `model` argument.
    autoEngine: "gemini",
  });
}
