import { NEUTRAL_DEFAULTS, type KnowledgeNodeInput, type MediaKind } from "@/domain";
import { getCurrentOrgId } from "@/lib/auth/org";
import { getBusinessProfile, upsertBusinessProfile } from "@/lib/brand-kit/persistence";
import { createNode } from "@/lib/knowledge-graph/persistence";
import { type TypedSupabaseClient, getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import {
  extractBrandKnowledgeBundleWithGemini,
  mergeBrandProfileUpdate,
  type BrandKnowledgeExtraction,
  type BrandProfileUpdate,
} from "./gemini-parser";
import { classifyBrandSource, type BrandSourceClassification } from "./source-classifier";

export type BrandKnowledgeAsset = {
  id: string;
  fileName: string;
  kind: MediaKind;
  source: string;
  tags: string[];
  availableToArc: boolean;
  url?: string | null;
  extractedText?: string | null;
  contentType?: string | null;
  fileBytes?: Uint8Array | null;
};

type BrainSyncDeps = {
  client?: TypedSupabaseClient;
  orgId?: string;
  extractKnowledge?: (asset: BrandKnowledgeAsset, classification: BrandSourceClassification) => Promise<BrandKnowledgeExtraction>;
  extractNodes?: (asset: BrandKnowledgeAsset, classification: BrandSourceClassification) => Promise<KnowledgeNodeInput[]>;
  updateProfile?: (update: BrandProfileUpdate) => Promise<void>;
};

export type BrandKnowledgeSyncResult = {
  created: number;
  skipped: number;
  errors: string[];
  updatedProfile?: boolean;
};

const KIND_BY_CATEGORY: Record<BrandSourceClassification["category"], string> = {
  brand_guidelines: "brand_fact",
  voice_messaging: "messaging_angle",
  proof: "proof_point",
  offerings: "brand_fact",
  visual_identity: "brand_fact",
  company_profile: "brand_fact",
  source_document: "brand_fact",
};

const CONFIDENCE_BY_LEVEL: Record<BrandSourceClassification["confidence"], number> = {
  high: 88,
  medium: 70,
  low: 45,
};

function sourceLabel(classification: BrandSourceClassification, fileName: string) {
  return `${classification.label} source: ${fileName}`;
}

function textPreview(value: string | null | undefined) {
  if (!value) return null;
  const preview = value.replace(/\s+/g, " ").trim();
  return preview ? preview.slice(0, 700) : null;
}

function sourceBody(asset: BrandKnowledgeAsset, classification: BrandSourceClassification) {
  const preview = textPreview(asset.extractedText);
  const parts = [
    `${asset.fileName} is attached to the Brand knowledge base as ${classification.label.toLowerCase()}.`,
    classification.reason,
  ];
  if (preview) parts.push(`Document preview: ${preview}`);
  parts.push(
    "Review this source and approve, edit, or reject the proposed Brain knowledge before it governs generated copy.",
  );
  return parts.join(" ");
}

export function proposeBrandKnowledgeNodes(
  asset: BrandKnowledgeAsset,
  classification: BrandSourceClassification = classifyBrandSource(asset),
): KnowledgeNodeInput[] {
  if (!asset.availableToArc) return [];
  if (classification.confidence === "low") return [];

  return [
    {
      kind: KIND_BY_CATEGORY[classification.category],
      key: `media_asset:${asset.id}:${classification.category}`,
      label: sourceLabel(classification, asset.fileName),
      body: sourceBody(asset, classification),
      summary: classification.reason,
      confidence: CONFIDENCE_BY_LEVEL[classification.confidence],
      refTable: "media_assets",
      refId: asset.id,
      source: "brand_source_ingestion",
      sourceReference: `media_assets:${asset.id}`,
      tags: ["brand-source", classification.category, asset.source, ...asset.tags],
      props: {
        mediaAssetId: asset.id,
        fileName: asset.fileName,
        source: asset.source,
        sourceUrl: asset.url ?? null,
        extractedTextPreview: textPreview(asset.extractedText),
        brandSourceCategory: classification.category,
        brandSourceLabel: classification.label,
        brandSourceConfidence: classification.confidence,
      },
    },
  ];
}

async function resolveDeps(deps: BrainSyncDeps): Promise<{ client: TypedSupabaseClient; orgId: string } | null> {
  if (deps.client && deps.orgId) return { client: deps.client, orgId: deps.orgId };
  if (!isSupabaseAdminConfigured()) return null;
  return { client: deps.client ?? getSupabaseAdminClient(), orgId: deps.orgId ?? (await getCurrentOrgId()) };
}

async function existingKeysForAsset(assetId: string, deps: { client: TypedSupabaseClient; orgId: string }) {
  const { data, error } = await deps.client
    .from("knowledge_nodes")
    .select("key")
    .eq("org_id", deps.orgId)
    .eq("ref_table", "media_assets")
    .eq("ref_id", assetId);
  if (error) throw new Error(error.message);
  return new Set(
    ((data ?? []) as Array<{ key: string | null }>)
      .map((row) => row.key)
      .filter((key): key is string => Boolean(key)),
  );
}

async function defaultUpdateBrandProfile(orgId: string, update: BrandProfileUpdate) {
  const current = (await getBusinessProfile(orgId)) ?? NEUTRAL_DEFAULTS;
  await upsertBusinessProfile(orgId, mergeBrandProfileUpdate(current, update));
}

async function extractKnowledge(
  asset: BrandKnowledgeAsset,
  classification: BrandSourceClassification,
  deps: BrainSyncDeps,
  orgId: string,
): Promise<BrandKnowledgeExtraction> {
  if (deps.extractKnowledge) return deps.extractKnowledge(asset, classification);
  if (deps.extractNodes) return { nodes: await deps.extractNodes(asset, classification), profile: null };
  // orgId is threaded purely so the Gemini call can be billed to someone (BSR-502).
  return extractBrandKnowledgeBundleWithGemini(asset, { orgId });
}

export async function learnBrandKnowledgeFromAsset(
  asset: BrandKnowledgeAsset,
  deps: BrainSyncDeps = {},
): Promise<BrandKnowledgeSyncResult> {
  const resolved = await resolveDeps(deps);
  if (!resolved) return { created: 0, skipped: 0, errors: ["Supabase is not configured."] };

  const classification = classifyBrandSource(asset);
  const sourceProposals = proposeBrandKnowledgeNodes(asset, classification);
  const extracted = await extractKnowledge(asset, classification, deps, resolved.orgId).catch(() => ({ nodes: [], profile: null }));
  const proposals = [...sourceProposals, ...extracted.nodes];
  if (proposals.length === 0 && !extracted.profile) return { created: 0, skipped: 1, errors: [] };

  const result: BrandKnowledgeSyncResult = { created: 0, skipped: 0, errors: [] };
  if (extracted.profile) {
    try {
      if (deps.updateProfile) await deps.updateProfile(extracted.profile);
      else await defaultUpdateBrandProfile(resolved.orgId, extracted.profile);
      result.updatedProfile = true;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "Could not update the Brand profile.");
    }
  }

  let existingKeys = new Set<string>();
  if (proposals.length > 0) {
    try {
      existingKeys = await existingKeysForAsset(asset.id, resolved);
    } catch (error) {
      return { ...result, errors: [...result.errors, error instanceof Error ? error.message : "Could not inspect Brain."] };
    }
  }

  for (const proposal of proposals) {
    if (proposal.key && existingKeys.has(proposal.key)) {
      result.skipped += 1;
      continue;
    }
    const write = await createNode(proposal, { ...resolved, createdBy: "arc" });
    if (write.ok) {
      result.created += 1;
      if (proposal.key) existingKeys.add(proposal.key);
    } else {
      result.errors.push(write.error);
    }
  }

  return result;
}
