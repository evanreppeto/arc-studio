import { type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient } from "../supabase/server";
import { type AgentTaskTenantFields } from "../agent-tasks/scope";
import { insertNoReturn } from "./create";

export type AttachMediaToCampaignAssetInput = {
  assetId: string;
  libraryAssetId: string;
  operator: string;
  tenant?: AgentTaskTenantFields;
};

export type AttachMediaResult = { assetId: string; campaignId: string; attached: boolean };

type LibraryAssetRow = {
  id: string;
  file_name: string;
  public_url: string;
  storage_path: string;
  kind: string;
  source: string | null;
  provenance: Record<string, unknown> | null;
  risk_flags: string[] | null;
};

type CampaignAssetMediaRow = {
  id: string;
  campaign_id: string;
  audit_payload: Record<string, unknown> | null;
};

/**
 * Attach an approved Library media asset to an EXISTING campaign asset by
 * appending to its `audit_payload.media_assets` — the same shape the read-model
 * renders (with provenance). Operator-facing companion to Arc's library/attach
 * route, but it edits the asset in place instead of creating a new piece.
 *
 * Approval-safe: status and dispatch lock are left untouched and outbound stays
 * locked. Idempotent: re-attaching the same library asset is a no-op.
 */
export async function attachMediaToCampaignAsset(
  input: AttachMediaToCampaignAssetInput,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<AttachMediaResult> {
  const tenant = input.tenant;

  // Resolve the Library asset (org-scoped). Operators may attach any asset in
  // their workspace — `available_to_arc` only gates Arc, not humans.
  const library = await resolveLibraryAsset(client, input.libraryAssetId, tenant);
  if (!library) throw new Error("Library media not found for this workspace.");

  const asset = await loadCampaignAsset(client, input.assetId, tenant);
  if (!asset) throw new Error("Campaign asset not found.");

  const audit = isRecord(asset.audit_payload) ? { ...asset.audit_payload } : {};
  const existing = Array.isArray(audit.media_assets) ? [...(audit.media_assets as unknown[])] : [];

  // Idempotent: don't duplicate an already-attached library asset.
  if (existing.some((m) => isRecord(m) && m.library_asset_id === library.id)) {
    return { assetId: asset.id, campaignId: asset.campaign_id, attached: false };
  }

  const mediaEntry = buildMediaEntry(library);
  const nextAudit = { ...audit, media_assets: [...existing, mediaEntry], outbound_locked: true };

  const { error } = await applyOrgScope(
    client
      .from("campaign_assets")
      .update({ audit_payload: nextAudit, updated_at: new Date().toISOString() })
      .eq("id", asset.id),
    tenant,
  );
  if (error) throw new Error(`campaign_assets update failed: ${error.message}`);

  await insertNoReturn(client, "campaign_events", {
    ...orgTenantFields(tenant),
    campaign_id: asset.campaign_id,
    campaign_asset_id: asset.id,
    event_type: "asset_generated",
    actor: input.operator,
    detail: `${input.operator} attached approved media (${library.file_name}).`,
    payload: { source: "operator_attach_media", library_asset_id: library.id },
  });

  return { assetId: asset.id, campaignId: asset.campaign_id, attached: true };
}

/** Build the `media_assets[]` entry in the shape `collectMediaFromAsset` reads. */
function buildMediaEntry(library: LibraryAssetRow): Record<string, unknown> {
  const provenance = isRecord(library.provenance) ? library.provenance : {};
  const generated = library.source === "ai_generated";
  const jobId = typeof provenance.job_id === "string" ? provenance.job_id : typeof provenance.jobId === "string" ? provenance.jobId : null;
  return {
    url: library.public_url,
    path: library.storage_path,
    library_asset_id: library.id,
    ...(library.source ? { source: library.source } : {}),
    ...(library.risk_flags?.length ? { risk_flags: library.risk_flags } : {}),
    ...(generated ? { generated_by: "library" } : {}),
    // External lineage (BYO-tool ingest stores camelCase; carry it snake_cased
    // like the rest of the audit payload) so the campaign card can show it.
    ...(typeof provenance.tool === "string" ? { tool: provenance.tool } : {}),
    ...(typeof provenance.model === "string" ? { model: provenance.model } : {}),
    ...(typeof provenance.prompt === "string" ? { prompt: provenance.prompt } : {}),
    ...(jobId ? { job_id: jobId } : {}),
    ...(typeof provenance.sourceUrl === "string" ? { source_url: provenance.sourceUrl } : {}),
  };
}

export type AttachableMediaItem = {
  id: string;
  fileName: string;
  url: string;
  kind: string;
  dimensions: string | null;
};

type AttachableMediaRow = {
  id: string;
  file_name: string;
  public_url: string;
  kind: string;
  width: number | null;
  height: number | null;
};

/** List the org's visual Library assets an operator can attach to a campaign
 *  asset. Unlike Arc's list, this is NOT gated by `available_to_arc`. */
export async function listAttachableMedia(
  orgId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
  opts: { limit?: number } = {},
): Promise<AttachableMediaItem[]> {
  const { data, error } = await client
    .from("media_assets" as string)
    .select("id, file_name, public_url, kind, width, height")
    .eq("org_id", orgId)
    .in("kind", ["image", "logo", "video"])
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 60, 1), 200));
  if (error) throw new Error(`list attachable media failed: ${error.message}`);
  return ((data ?? []) as AttachableMediaRow[]).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    url: row.public_url,
    kind: row.kind,
    dimensions: row.width != null && row.height != null ? `${row.width} × ${row.height}` : null,
  }));
}

async function resolveLibraryAsset(
  client: SupabaseClient,
  libraryAssetId: string,
  tenant?: AgentTaskTenantFields,
): Promise<LibraryAssetRow | null> {
  const query = applyOrgScope(
    client
      .from("media_assets" as string)
      .select("id, file_name, public_url, storage_path, kind, source, provenance, risk_flags")
      .eq("id", libraryAssetId),
    tenant,
  );
  const { data, error } = await query.maybeSingle<LibraryAssetRow>();
  if (error) throw new Error(`media_assets lookup failed: ${error.message}`);
  if (!data) return null;
  return { ...data, risk_flags: data.risk_flags ?? [], provenance: data.provenance ?? {} };
}

async function loadCampaignAsset(
  client: SupabaseClient,
  assetId: string,
  tenant?: AgentTaskTenantFields,
): Promise<CampaignAssetMediaRow | null> {
  const query = applyOrgScope(
    client.from("campaign_assets").select("id, campaign_id, audit_payload").eq("id", assetId),
    tenant,
  );
  const { data, error } = await query.maybeSingle<CampaignAssetMediaRow>();
  if (error) throw new Error(`campaign_assets lookup failed: ${error.message}`);
  return data ?? null;
}

function applyOrgScope<Query>(query: Query, tenant?: AgentTaskTenantFields): Query {
  if (!tenant) return query;
  return (query as { eq(column: string, value: string): Query }).eq("org_id", tenant.org_id);
}

function orgTenantFields(tenant?: AgentTaskTenantFields): Record<string, string> {
  return tenant ? { org_id: tenant.org_id } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
