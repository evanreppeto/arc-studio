import { type SupabaseClient } from "@supabase/supabase-js";

import {
  channelPreviewKind,
  isDraftEdited,
  resolveDraftFields,
  type ChannelPreviewKind,
  type ResolvedDraftFields,
} from "@/domain";

import { getSupabaseAdminClient } from "../supabase/server";
import { workspaceIdFields } from "@/lib/tenancy/resolve-workspace";

export type DraftAssetView = {
  assetId: string;
  campaignId: string;
  channel: string;
  kind: ChannelPreviewKind;
  fields: ResolvedDraftFields;
  edited: boolean;
  status: string;
  dispatchLocked: boolean;
};

type AssetRow = {
  id: string;
  campaign_id: string;
  channel: string | null;
  asset_type: string | null;
  title: string | null;
  status: string;
  dispatch_locked: boolean;
  draft_body: string | null;
  edited_body: string | null;
  prompt_inputs: Record<string, unknown> | null;
  edited_fields: Record<string, unknown> | null;
};

const ASSET_COLUMNS =
  "id, campaign_id, channel, asset_type, title, status, dispatch_locked, draft_body, edited_body, prompt_inputs, edited_fields";

function assertOk(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label} failed: ${error.message}`);
}

/** Load the live editable view of a draft asset (or null if missing). */
export async function getDraftAsset(
  assetId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<DraftAssetView | null> {
  const { data, error } = await client
    .from("campaign_assets")
    .select(ASSET_COLUMNS)
    .eq("id", assetId)
    .maybeSingle<AssetRow>();
  assertOk("campaign_assets draft lookup", error);
  if (!data) return null;

  const raw = {
    title: data.title,
    draftBody: data.draft_body,
    editedBody: data.edited_body,
    promptInputs: data.prompt_inputs,
    editedFields: data.edited_fields,
  };
  return {
    assetId: data.id,
    campaignId: data.campaign_id,
    channel: data.channel ?? data.asset_type ?? "",
    kind: channelPreviewKind(data.channel, data.asset_type),
    fields: resolveDraftFields(raw),
    edited: isDraftEdited(raw),
    status: data.status,
    dispatchLocked: data.dispatch_locked,
  };
}

export type EditDraftAssetInput = {
  assetId: string;
  campaignId: string;
  title?: string;
  body?: string;
  fields: Record<string, string>;
};

/**
 * Persist an operator's in-canvas edit: body -> edited_body, structured fields ->
 * edited_fields (+ title when present), and log an `asset_edited` event. Never
 * touches dispatch_locked / launch_locked — outbound stays locked.
 */
export async function editDraftAsset(
  input: EditDraftAssetInput,
  operator: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { assetId, campaignId, title, body, fields } = input;

  // Keep only non-empty structured fields so edited_fields stays a clean signal.
  const cleanFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string" && value.trim()) cleanFields[key] = value;
  }

  const update: Record<string, unknown> = {
    edited_fields: cleanFields,
    updated_at: new Date().toISOString(),
  };
  if (typeof body === "string") update.edited_body = body;
  if (typeof title === "string" && title.trim()) update.title = title.trim();

  // Return the asset's org so the event below can inherit it: campaign_events.org_id
  // is NOT NULL with no column default, and this caller has no tenant of its own to
  // pass. Reading it back off the update we already issue avoids a second round-trip.
  const { data: asset, error: assetError } = await client
    .from("campaign_assets")
    .update(update)
    .eq("id", assetId)
    .select("org_id")
    .maybeSingle<{ org_id: string }>();
  assertOk("campaign_assets edit", assetError);
  if (!asset) throw new Error("campaign_assets edit failed: asset not found");

  const editedKeys = Object.keys(cleanFields);
  const parts = [...editedKeys];
  if (typeof body === "string" && body.trim()) parts.push("body");
  const detail = `Draft edited by ${operator}${parts.length ? `: ${parts.join(", ")}` : ""}`;

  const { error: eventError } = await client.from("campaign_events").insert({
    org_id: asset.org_id,
    ...(await workspaceIdFields(client, asset.org_id, { campaignAssetId: assetId, campaignId: campaignId || null })),
    campaign_id: campaignId || null,
    campaign_asset_id: assetId,
    event_type: "asset_edited",
    actor: operator,
    detail,
    payload: { edited_fields: editedKeys, body_edited: typeof body === "string", outbound_locked: true },
  });
  assertOk("campaign_events insert", eventError);
}
