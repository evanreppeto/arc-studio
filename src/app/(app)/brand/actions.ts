"use server";

import { revalidatePath } from "next/cache";

import { applyBrandPaletteEdit, isCatalogFont, NEUTRAL_DEFAULTS, type BrandPaletteEdit, type MediaKind } from "@/domain";
import { getOperatorActor, requireOperator } from "@/lib/auth/operator";
import { getCurrentOrgId } from "@/lib/auth/org";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { extractAssetText } from "@/lib/brand-knowledge/asset-text";
import { learnBrandKnowledgeFromAsset } from "@/lib/brand-knowledge/brain-sync";
import { getBrandSource, listBrandSources } from "@/lib/brand-knowledge/sources-read-model";
import {
  summarizeBrandKnowledgeSync,
  type BrandKnowledgeSyncSummary,
  type BrandKnowledgeSyncTotals,
} from "@/lib/brand-knowledge/sync-summary";
import { uploadBrandingImage } from "@/lib/branding/images";
import { setWorkspaceLogo } from "@/lib/branding/logo";
import { getBusinessProfile, upsertBusinessProfile } from "@/lib/brand-kit/persistence";
import { fetchBrandSignalFromUrl } from "@/lib/brand-kit/website-fetch";
import { insertAssetWithUrl, loadAssetForLearning } from "@/lib/media-library/persistence";
import { MAX_UPLOAD_BYTES, acceptUpload, kindForContentType } from "@/lib/media-library/upload-policy";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Edit the brand identity (name, tagline, website, voice guidance) and persist
 * it to the org's business_profiles row. Internal config — nothing outbound.
 * Fetch-merge-upsert so we only touch the identity fields and leave palette,
 * services, guardrails, etc. intact. `persisted: false` is the honest offline
 * signal so the UI can reflect the edit without claiming it saved.
 */
export type BrandIdentityInput = {
  displayName: string;
  tagline: string;
  websiteUrl: string;
  voiceGuidance: string;
};

export type BrandSaveResult = { ok: true; persisted: boolean } | { ok: false; error: string };

export async function updateBrandIdentity(input: BrandIdentityInput): Promise<BrandSaveResult> {
  await requireOperator();

  const displayName = input.displayName?.trim();
  if (!displayName) return { ok: false, error: "A brand name is required." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const ctx = await getCurrentWorkspaceContext();
  try {
    const current = (await getBusinessProfile(ctx.orgId)) ?? NEUTRAL_DEFAULTS;
    await upsertBusinessProfile(ctx.orgId, {
      ...current,
      displayName,
      tagline: input.tagline?.trim() || null,
      websiteUrl: input.websiteUrl?.trim() || null,
      voiceGuidance: input.voiceGuidance?.trim() || null,
    });
    revalidatePath("/brand");
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save brand changes." };
  }
}

/**
 * Edit the brand palette and typography — the five colour slots plus the heading
 * and body faces.
 *
 * This write path already existed and was reachable by Arc
 * (`POST /api/v1/arc/brand/profile` sets every one of these fields), but never by
 * the operator: both controls on /brand were inert spans badged "coming soon"
 * while the agent could recolour and re-font the workspace at will.
 *
 * Same fetch-merge-upsert shape as `updateBrandIdentity`, so a palette edit
 * leaves voice, services and guardrails alone. Internal config — a palette
 * change never reaches anyone outside the workspace on its own; creative drawn
 * with it still goes through approval.
 */
export type BrandPaletteResult =
  | { ok: true; persisted: boolean }
  | { ok: false; error: string };

export async function updateBrandPalette(edit: BrandPaletteEdit): Promise<BrandPaletteResult> {
  await requireOperator();

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.orgId) return { ok: false, error: "No active workspace." };

  try {
    const current = (await getBusinessProfile(ctx.orgId)) ?? NEUTRAL_DEFAULTS;
    const applied = applyBrandPaletteEdit(current.brandPalette, edit);
    // A bad hex comes back as an error rather than a silent no-op: the operator
    // is looking at the colour they typed, and a quiet save would leave the old
    // one in place under a "Saved" badge.
    if (!applied.ok) return { ok: false, error: applied.errors.join(" ") };

    await upsertBusinessProfile(ctx.orgId, { ...current, brandPalette: applied.palette });
    revalidatePath("/brand");
    // Studio renders its swatches and canvas from this palette, and the shell
    // reads brand identity — both go stale otherwise.
    revalidatePath("/studio");
    revalidatePath("/", "layout");
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save your palette." };
  }
}

/**
 * Set the brand's heading and body typefaces.
 *
 * Only families in the BRAND_FONTS catalog are accepted, and that is the point:
 * the catalog is exactly the set the creative renderer ships static weights for
 * (`loadCreativeFonts`). Accepting an arbitrary family name here would store a
 * font that looks right in the app and renders as something else in every ad
 * Arc generates — a substitution the approving operator never sees.
 */
export type BrandTypographyResult =
  | { ok: true; persisted: boolean }
  | { ok: false; error: string };

export async function updateBrandTypography(input: {
  headingFont: string;
  bodyFont: string;
}): Promise<BrandTypographyResult> {
  await requireOperator();

  for (const [field, value] of [["heading", input.headingFont], ["body", input.bodyFont]] as const) {
    if (!isCatalogFont(value)) {
      return { ok: false, error: `That ${field} font isn't one we can render. Pick one from the list.` };
    }
  }

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.orgId) return { ok: false, error: "No active workspace." };

  try {
    const current = (await getBusinessProfile(ctx.orgId)) ?? NEUTRAL_DEFAULTS;
    const applied = applyBrandPaletteEdit(current.brandPalette, {
      headingFont: input.headingFont,
      bodyFont: input.bodyFont,
    });
    if (!applied.ok) return { ok: false, error: applied.errors.join(" ") };

    await upsertBusinessProfile(ctx.orgId, { ...current, brandPalette: applied.palette });
    revalidatePath("/brand");
    revalidatePath("/studio");
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save your typography." };
  }
}

/**
 * The workspace logo — one image, used in the nav rail AND stamped on generated
 * creative (`toBrandTokens` → `renderCreative`).
 *
 * The same store backs the Settings control; `setWorkspaceLogo` is the single
 * writer, so uploading from either screen changes both places. Storage is the
 * operator-gated `uploadBrandingImage` path (type/size checked there). Nothing
 * outbound — creative carrying this logo still goes through approval.
 */
export type BrandLogoResult = { ok: true; url: string | null } | { ok: false; error: string };

async function saveProfileLogo(orgId: string, logoUrl: string | null): Promise<void> {
  await setWorkspaceLogo(orgId, logoUrl);
  revalidatePath("/brand");
  // The rail and the Studio preview render from the same value.
  revalidatePath("/", "layout");
  revalidatePath("/studio");
}

export async function saveBrandLogo(formData: FormData): Promise<BrandLogoResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect a workspace to upload a logo." };

  const image = formData.get("file");
  if (!(image instanceof File) || image.size === 0) return { ok: false, error: "Choose an image first." };

  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.orgId) return { ok: false, error: "No active workspace." };

  const uploaded = await uploadBrandingImage(`org/${ctx.orgId}/brand`, image);
  if (!uploaded.ok) return { ok: false, error: uploaded.error };

  try {
    await saveProfileLogo(ctx.orgId, uploaded.url);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save the logo." };
  }
  return { ok: true, url: uploaded.url };
}

export async function removeBrandLogo(): Promise<BrandLogoResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect a workspace first." };

  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.orgId) return { ok: false, error: "No active workspace." };

  try {
    await saveProfileLogo(ctx.orgId, null);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not remove the logo." };
  }
  return { ok: true, url: null };
}

/**
 * Read a public website and return the brand signal it carries (title,
 * description, favicon, readable text).
 *
 * The implementation already existed and was reachable by Arc
 * (`POST /api/v1/arc/brand/analyze-website`) but never by the operator's own
 * "Analyze" button, which was marked coming-soon. Same SSRF-guarded fetch, same
 * limits — `fetchBrandSignalFromUrl` refuses private/loopback hosts, caps
 * redirects and body size, and times out. Read-only: nothing is written and
 * nothing goes outbound; the operator decides what to keep.
 */
export type BrandWebsiteAnalysis =
  | { ok: true; title: string | null; description: string | null; faviconUrl: string | null; excerpt: string }
  | { ok: false; error: string };

const ANALYSIS_EXCERPT_CHARS = 1200;

export async function analyzeBrandWebsite(url: string): Promise<BrandWebsiteAnalysis> {
  await requireOperator();

  const trimmed = url?.trim();
  if (!trimmed) return { ok: false, error: "Enter a website address first." };

  const result = await fetchBrandSignalFromUrl(trimmed);
  if (!result.ok) return { ok: false, error: result.message };

  const { title, description, faviconUrl, text } = result.signal;
  return {
    ok: true,
    title,
    description,
    faviconUrl,
    excerpt: text.slice(0, ANALYSIS_EXCERPT_CHARS),
  };
}

// ---------------------------------------------------------------------------
// Brand document intake. Dropping a file into "Teach Arc your brand" is the act
// of consent, so these uploads land available_to_arc = true (unlike Library
// uploads, which default to held). The real gate stays downstream: every fact
// Gemini proposes enters the Brain as `proposed` and governs no copy until an
// operator approves it in /brain. Nothing here is outbound.
// ---------------------------------------------------------------------------

export type BrandUploadResult =
  | { ok: true; persisted: boolean; summary: BrandKnowledgeSyncSummary }
  | { ok: false; error: string };

/**
 * Upload one or more brand documents, then learn from each: persist to
 * media_assets (Arc-available), extract text (.docx/.md/.csv/.txt) or pass raw
 * bytes for Gemini to read natively (PDF), and propose Brain nodes for review.
 * Per-file failures are collected, not thrown — one bad file never sinks the
 * batch. Returns the aggregate summary banner.
 */
export async function uploadBrandDocuments(formData: FormData): Promise<BrandUploadResult> {
  await requireOperator();

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, error: "Choose at least one file." };

  for (const file of files) {
    if (!acceptUpload(file.name, file.type).ok) {
      return { ok: false, error: `Unsupported file type: ${file.name}. Use .docx, .pdf, .md, .csv, or .txt.` };
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: `${file.name} is too large — keep each file under 50MB.` };
    }
  }

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, summary: summarizeBrandKnowledgeSync({ sources: 0, created: 0, skipped: 0, updatedProfiles: 0, errors: [] }) };

  const [orgId, uploadedBy] = await Promise.all([getCurrentOrgId(), getOperatorActor()]);
  const totals: BrandKnowledgeSyncTotals = { sources: 0, created: 0, skipped: 0, updatedProfiles: 0, errors: [] };

  for (const file of files) {
    const accepted = acceptUpload(file.name, file.type);
    if (!accepted.ok) continue; // already validated above; keeps the type narrow
    const contentType = accepted.contentType;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { id, url } = await insertAssetWithUrl({
        orgId,
        folderId: null,
        fileName: file.name,
        bytes,
        contentType,
        kind: kindForContentType(contentType),
        byteSize: file.size,
        source: "uploaded",
        provenance: { origin: "brand_upload" },
        availableToArc: true,
        uploadedBy,
      });
      totals.sources += 1;

      const extractedText = await extractAssetText({ bytes, contentType, fileName: file.name });
      const result = await learnBrandKnowledgeFromAsset(
        {
          id,
          fileName: file.name,
          kind: kindForContentType(contentType),
          source: "uploaded",
          tags: [],
          availableToArc: true,
          url,
          extractedText,
          contentType,
          fileBytes: bytes,
        },
        { orgId }, // pin the org we already resolved; don't re-derive it downstream
      );
      totals.created += result.created;
      totals.skipped += result.skipped;
      if (result.updatedProfile) totals.updatedProfiles += 1;
      totals.errors.push(...result.errors.map((e) => `${file.name}: ${e}`));
    } catch (error) {
      totals.errors.push(`${file.name}: ${error instanceof Error ? error.message : "upload failed"}`);
    }
  }

  revalidatePath("/brand");
  revalidatePath("/brain");
  revalidatePath("/library");
  return { ok: true, persisted: true, summary: summarizeBrandKnowledgeSync(totals) };
}

/**
 * Re-learn one already-stored brand source (or all of them when assetId is
 * omitted) — used when a document changes or its first parse missed something.
 * Idempotent: learnBrandKnowledgeFromAsset skips facts already in the Brain, so
 * a re-sync only adds what's genuinely new.
 */
export async function resyncBrandSources(assetId?: string): Promise<BrandUploadResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, summary: summarizeBrandKnowledgeSync({ sources: 0, created: 0, skipped: 0, updatedProfiles: 0, errors: [] }) };

  const orgId = await getCurrentOrgId();
  const ids = assetId ? [assetId] : (await listBrandSources(orgId)).map((s) => s.id);
  const totals: BrandKnowledgeSyncTotals = { sources: 0, created: 0, skipped: 0, updatedProfiles: 0, errors: [] };

  for (const id of ids) {
    try {
      // Confirm the id is a brand source in this org before touching storage.
      const source = await getBrandSource(id, orgId);
      if (!source) {
        totals.errors.push("A source could not be found.");
        continue;
      }
      const asset = await loadAssetForLearning(id, orgId);
      if (!asset) {
        totals.errors.push(`${source.fileName}: file could not be read.`);
        continue;
      }
      totals.sources += 1;
      const extractedText = await extractAssetText({ bytes: asset.bytes, contentType: asset.contentType, fileName: asset.fileName });
      const result = await learnBrandKnowledgeFromAsset(
        {
          id: asset.id,
          fileName: asset.fileName,
          kind: asset.kind as MediaKind,
          source: asset.source,
          tags: asset.tags,
          availableToArc: true,
          url: asset.url,
          extractedText,
          contentType: asset.contentType,
          fileBytes: asset.bytes,
        },
        { orgId }, // pin the org we already resolved; don't re-derive it downstream
      );
      totals.created += result.created;
      totals.skipped += result.skipped;
      if (result.updatedProfile) totals.updatedProfiles += 1;
      totals.errors.push(...result.errors.map((e) => `${asset.fileName}: ${e}`));
    } catch (error) {
      totals.errors.push(error instanceof Error ? error.message : "Re-sync failed for a source.");
    }
  }

  revalidatePath("/brand");
  revalidatePath("/brain");
  return { ok: true, persisted: true, summary: summarizeBrandKnowledgeSync(totals) };
}
