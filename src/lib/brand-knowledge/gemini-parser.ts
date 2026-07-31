import { GoogleGenAI } from "@google/genai";

import { meterGeminiTextUsage } from "@/lib/ai-usage/gemini-text";
import { reportDegraded } from "@/lib/observability/report-degraded";

import { mergeBrandPalette, NEUTRAL_DEFAULTS, type BrandColor, type BrandPaletteUpdate, type BusinessProfile, type KnowledgeNodeInput, type ProofPoint } from "@/domain";

import { type BrandKnowledgeAsset } from "./brain-sync";

type ParsedBrandKnowledgeNode = {
  kind: "brand_fact" | "messaging_angle" | "proof_point" | "cta";
  label: string;
  body: string | null;
  summary: string | null;
  confidence: number;
  tags: string[];
};

type GeminiDeps = {
  apiKey?: string;
  model?: string;
  generateText?: (prompt: string, asset: BrandKnowledgeAsset) => Promise<string>;
  /**
   * Org this extraction bills to (BSR-502). Optional in the type because this is
   * an exported entry point with existing callers, but a real Gemini call made
   * WITHOUT it is reported rather than silently unmetered — an unattributable
   * cost is a finding, not a no-op.
   */
  orgId?: string;
};

export type BrandProfileUpdate = {
  displayName?: string | null;
  legalName?: string | null;
  tagline?: string | null;
  description?: string | null;
  industry?: string | null;
  websiteUrl?: string | null;
  serviceAreas?: string[];
  tone?: string | null;
  voiceGuidance?: string | null;
  preferredPhrases?: string[];
  bannedPhrases?: string[];
  services?: string[];
  proofPoints?: string[];
  disallowedClaims?: string[];
  complianceNotes?: string | null;
  brandPalette?: BrandPaletteUpdate | null;
  shortMark?: string | null;
};

export type BrandKnowledgeExtraction = {
  nodes: KnowledgeNodeInput[];
  profile: BrandProfileUpdate | null;
};

const ALLOWED_KINDS = new Set<ParsedBrandKnowledgeNode["kind"]>([
  "brand_fact",
  "messaging_angle",
  "proof_point",
  "cta",
]);

const DEFAULT_TEXT_MODEL = "gemini-2.5-flash-lite";

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength).trim() : "";
}

function cleanOptionalText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() || null;
}

function cleanArray(value: unknown, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const cleaned = cleanText(item, maxLength);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= 20) break;
  }
  return out;
}

function mergeList(current: string[], incoming: string[] | undefined) {
  const out = [...current];
  const seen = new Set(out.map((item) => item.toLowerCase()));
  for (const raw of incoming ?? []) {
    const item = cleanOptionalText(raw);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function mergeProofPoints(current: ProofPoint[], incoming: string[] | undefined) {
  const out = [...current];
  const seen = new Set(out.map((point) => point.label.toLowerCase()));
  for (const raw of incoming ?? []) {
    const label = cleanOptionalText(raw);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "stat", label });
  }
  return out;
}

function keepOrFill(current: string | null | undefined, incoming: string | null | undefined) {
  const currentValue = cleanOptionalText(current);
  return currentValue ?? cleanOptionalText(incoming);
}

function mergeText(current: string | null | undefined, incoming: string | null | undefined) {
  const currentValue = cleanOptionalText(current);
  const incomingValue = cleanOptionalText(incoming);
  if (!incomingValue) return currentValue;
  if (!currentValue) return incomingValue;
  if (currentValue.toLowerCase().includes(incomingValue.toLowerCase())) return currentValue;
  return `${currentValue}\n\n${incomingValue}`;
}

export function mergeBrandProfileUpdate(current: BusinessProfile, update: BrandProfileUpdate): BusinessProfile {
  const tone = cleanOptionalText(update.tone);

  return {
    ...current,
    displayName: keepOrFill(current.displayName, update.displayName) ?? current.displayName,
    legalName: keepOrFill(current.legalName, update.legalName),
    tagline: keepOrFill(current.tagline, update.tagline),
    description: mergeText(current.description, update.description),
    industry: keepOrFill(current.industry, update.industry),
    websiteUrl: keepOrFill(current.websiteUrl, update.websiteUrl),
    serviceAreas: mergeList(current.serviceAreas, update.serviceAreas),
    tone: current.tone === NEUTRAL_DEFAULTS.tone && tone ? tone : current.tone,
    voiceGuidance: mergeText(current.voiceGuidance, update.voiceGuidance),
    preferredPhrases: mergeList(current.preferredPhrases, update.preferredPhrases),
    bannedPhrases: mergeList(current.bannedPhrases, update.bannedPhrases),
    services: mergeList(current.services, update.services),
    proofPoints: mergeProofPoints(current.proofPoints, update.proofPoints),
    guardrails: {
      disallowedClaims: mergeList(current.guardrails.disallowedClaims, update.disallowedClaims),
      complianceNotes: mergeText(current.guardrails.complianceNotes, update.complianceNotes) ?? "",
    },
    brandPalette: mergeBrandPalette(current.brandPalette, update.brandPalette),
    shortMark: keepOrFill(current.shortMark, update.shortMark),
  };
}

function cleanTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const tag = cleanText(item, 32).toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 6) break;
  }
  return out;
}

function clampConfidence(value: unknown) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return 78;
  return Math.min(95, Math.max(65, Math.round(confidence)));
}

function extractJson(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  return first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed;
}

export function parseBrandKnowledgeJson(value: string): ParsedBrandKnowledgeNode[] {
  return parseBrandKnowledgeExtractionJson(value).nodes;
}

function parsePaletteColor(value: unknown): BrandColor | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const hex = cleanText(v.hex, 12);
  if (!hex) return undefined;
  return { label: cleanText(v.label, 40), hex };
}

function parsePaletteUpdate(value: unknown): BrandPaletteUpdate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const out: BrandPaletteUpdate = {};
  for (const slot of ["primary", "secondary", "accent", "dark", "light"] as const) {
    const color = parsePaletteColor(v[slot]);
    if (color) out[slot] = color;
  }
  const headingFont = cleanText(v.headingFont, 60);
  const bodyFont = cleanText(v.bodyFont, 60);
  if (headingFont) out.headingFont = headingFont;
  if (bodyFont) out.bodyFont = bodyFont;
  return Object.keys(out).length > 0 ? out : null;
}

function parseProfile(value: unknown): BrandProfileUpdate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const profile: BrandProfileUpdate = {
    displayName: cleanText(item.displayName, 120) || null,
    legalName: cleanText(item.legalName, 160) || null,
    tagline: cleanText(item.tagline, 180) || null,
    description: cleanText(item.description, 900) || null,
    industry: cleanText(item.industry, 80) || null,
    websiteUrl: cleanText(item.websiteUrl, 240) || null,
    serviceAreas: cleanArray(item.serviceAreas),
    tone: cleanText(item.tone, 60) || null,
    voiceGuidance: cleanText(item.voiceGuidance, 900) || null,
    preferredPhrases: cleanArray(item.preferredPhrases),
    bannedPhrases: cleanArray(item.bannedPhrases),
    services: cleanArray(item.services),
    proofPoints: cleanArray(item.proofPoints),
    disallowedClaims: cleanArray(item.disallowedClaims),
    complianceNotes: cleanText(item.complianceNotes, 900) || null,
    brandPalette: parsePaletteUpdate(item.brandPalette),
    shortMark: cleanText(item.shortMark, 6) || null,
  };
  const hasValue = Object.values(profile).some((entry) => (Array.isArray(entry) ? entry.length > 0 : Boolean(entry)));
  return hasValue ? profile : null;
}

export function parseBrandKnowledgeExtractionJson(value: string): {
  nodes: ParsedBrandKnowledgeNode[];
  profile: BrandProfileUpdate | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(value));
  } catch {
    return { nodes: [], profile: null };
  }

  const rawNodes = parsed && typeof parsed === "object" && "nodes" in parsed ? (parsed as { nodes?: unknown }).nodes : [];
  const sourceNodes = Array.isArray(rawNodes) ? rawNodes : [];

  const out: ParsedBrandKnowledgeNode[] = [];
  const seen = new Set<string>();
  for (const raw of sourceNodes) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const kind = cleanText(item.kind, 40) as ParsedBrandKnowledgeNode["kind"];
    const label = cleanText(item.label, 120);
    if (!ALLOWED_KINDS.has(kind) || !label) continue;
    const key = `${kind}:${label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind,
      label,
      body: cleanText(item.body, 900) || null,
      summary: cleanText(item.summary, 240) || null,
      confidence: clampConfidence(item.confidence),
      tags: cleanTags(item.tags),
    });
    if (out.length >= 8) break;
  }
  return {
    nodes: out,
    profile: parsed && typeof parsed === "object" && "profile" in parsed ? parseProfile((parsed as { profile?: unknown }).profile) : null,
  };
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54)
    .replace(/-+$/g, "") || "brand-note";
}

export function toBrandKnowledgeNodeInputs(
  asset: BrandKnowledgeAsset,
  nodes: ParsedBrandKnowledgeNode[],
): KnowledgeNodeInput[] {
  return nodes.map((node) => ({
    kind: node.kind,
    key: `media_asset:${asset.id}:ai:${slug(node.label)}`,
    label: node.label,
    body: node.body,
    summary: node.summary,
    confidence: node.confidence,
    refTable: "media_assets",
    refId: asset.id,
    source: "brand_source_gemini",
    sourceReference: `media_assets:${asset.id}`,
    tags: ["brand-source", "ai-extracted", node.kind, ...node.tags],
    props: {
      mediaAssetId: asset.id,
      fileName: asset.fileName,
      source: asset.source,
      sourceUrl: asset.url ?? null,
      extractedBy: "gemini",
    },
  }));
}

export function toBrandKnowledgeExtraction(
  asset: BrandKnowledgeAsset,
  parsed: { nodes: ParsedBrandKnowledgeNode[]; profile: BrandProfileUpdate | null },
): BrandKnowledgeExtraction {
  return {
    nodes: toBrandKnowledgeNodeInputs(asset, parsed.nodes),
    profile: parsed.profile,
  };
}

function buildPrompt(asset: BrandKnowledgeAsset) {
  const text = asset.extractedText?.trim();
  return [
    "Read this brand source and extract only facts Mark can use after human approval.",
    "Return JSON only with this shape:",
    '{"profile":{"displayName":null,"legalName":null,"tagline":null,"description":null,"industry":null,"websiteUrl":null,"serviceAreas":[],"tone":null,"voiceGuidance":null,"preferredPhrases":[],"bannedPhrases":[],"services":[],"proofPoints":[],"disallowedClaims":[],"complianceNotes":null,"brandPalette":{"primary":{"label":"","hex":""},"secondary":{"label":"","hex":""},"accent":{"label":"","hex":""},"dark":{"label":"","hex":""},"light":{"label":"","hex":""},"headingFont":"","bodyFont":""},"shortMark":null},"nodes":[{"kind":"brand_fact|messaging_angle|proof_point|cta","label":"short fact","body":"supporting detail","summary":"optional short summary","confidence":80,"tags":["brand"]}]}',
    "Keep it conservative. Do not invent claims. If the source is weak, return an empty nodes array.",
    "Use profile for editable Brand details: company, voice, offerings, proof, and rules.",
    "For logos, photos, moodboards, and reference media, extract visual themes, colors, typography cues, logo usage, style rules, and brand-safe visual guidance. When colours are readable, populate profile.brandPalette (primary/secondary/accent/dark/light as {label,hex} with 6-digit hex, plus headingFont/bodyFont) and suggest a 1–3 character profile.shortMark.",
    `File name: ${asset.fileName}`,
    text ? `Document text:\n${text.slice(0, 16000)}` : "Use the attached file content.",
  ].join("\n\n");
}

async function callGemini(prompt: string, asset: BrandKnowledgeAsset, deps: GeminiDeps) {
  const apiKey = deps.apiKey ?? process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return "";
  const model = deps.model ?? process.env.BRAND_KNOWLEDGE_MODEL?.trim() ?? DEFAULT_TEXT_MODEL;
  const ai = new GoogleGenAI({ apiKey });
  const filePart =
    asset.fileBytes && asset.contentType
      ? {
          inlineData: {
            mimeType: asset.contentType,
            data: Buffer.from(asset.fileBytes).toString("base64"),
          },
        }
      : null;
  const contents = filePart
    ? [{ role: "user", parts: [{ text: prompt }, filePart] }]
    : prompt;

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      temperature: 0.1,
      maxOutputTokens: 1800,
      responseMimeType: "application/json",
    },
  });

  // Brand extraction is org-scoped (it writes Brain nodes, which have an org_id
  // and no workspace), so the ledger row is too. This call site was one of the
  // two Gemini text paths the BSR-502 audit found spending money with nowhere to
  // record it.
  if (deps.orgId) {
    await meterGeminiTextUsage(model, response.usageMetadata, {
      orgId: deps.orgId,
      workspaceId: null,
      purpose: "brand.knowledge-extract",
      keySource: deps.apiKey ? "workspace_vault" : "platform_env",
    });
  } else {
    // The call happened and cost money; we just cannot say whose. Reporting beats
    // skipping — a silently unattributed cost is exactly how this audit's findings
    // stayed invisible for weeks.
    reportDegraded(new Error("Brand-knowledge Gemini call ran without an orgId, so it could not be metered."), {
      scope: "ai-usage.unattributed",
      surface: "secondary",
      detail: { model, purpose: "brand.knowledge-extract" },
    });
  }

  return response.text ?? "";
}

export async function extractBrandKnowledgeWithGemini(
  asset: BrandKnowledgeAsset,
  deps: GeminiDeps = {},
): Promise<KnowledgeNodeInput[]> {
  return (await extractBrandKnowledgeBundleWithGemini(asset, deps)).nodes;
}

export async function extractBrandKnowledgeBundleWithGemini(
  asset: BrandKnowledgeAsset,
  deps: GeminiDeps = {},
): Promise<BrandKnowledgeExtraction> {
  if (!asset.availableToArc) return { nodes: [], profile: null };
  if (!asset.extractedText?.trim() && !asset.fileBytes) return { nodes: [], profile: null };

  const prompt = buildPrompt(asset);
  const text = deps.generateText ? await deps.generateText(prompt, asset) : await callGemini(prompt, asset, deps);
  return toBrandKnowledgeExtraction(asset, parseBrandKnowledgeExtractionJson(text));
}
