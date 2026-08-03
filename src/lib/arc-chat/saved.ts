import { type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient } from "../supabase/server";

export type SavedKind = "media" | "draft" | "angle";

export type SavedItem = {
  id: string;
  operator: string;
  kind: SavedKind;
  title: string | null;
  body: string | null;
  mediaUrl: string | null;
  caption: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  sourceCampaignId: string | null;
  sourceAssetId: string | null;
  note: string | null;
  promotedCampaignId: string | null;
  promotedAssetId: string | null;
  createdAt: string;
};

type SavedRow = {
  id: string;
  operator: string;
  kind: SavedKind;
  title: string | null;
  body: string | null;
  media_url: string | null;
  caption: string | null;
  source_conversation_id: string | null;
  source_message_id: string | null;
  source_campaign_id: string | null;
  source_asset_id: string | null;
  note: string | null;
  promoted_campaign_id: string | null;
  promoted_asset_id: string | null;
  created_at: string;
};

const COLUMNS =
  "id, operator, kind, title, body, media_url, caption, source_conversation_id, source_message_id, source_campaign_id, source_asset_id, note, promoted_campaign_id, promoted_asset_id, created_at";

function toSaved(row: SavedRow): SavedItem {
  return {
    id: row.id,
    operator: row.operator,
    kind: row.kind,
    title: row.title ?? null,
    body: row.body ?? null,
    mediaUrl: row.media_url ?? null,
    caption: row.caption ?? null,
    sourceConversationId: row.source_conversation_id ?? null,
    sourceMessageId: row.source_message_id ?? null,
    sourceCampaignId: row.source_campaign_id ?? null,
    sourceAssetId: row.source_asset_id ?? null,
    note: row.note ?? null,
    promotedCampaignId: row.promoted_campaign_id ?? null,
    promotedAssetId: row.promoted_asset_id ?? null,
    createdAt: row.created_at,
  };
}

export type SaveItemInput = {
  operator: string;
  /**
   * Required, because `arc_saved_items.org_id` is NOT NULL with no default.
   * This used to be optional and the insert below omitted the column when it
   * was absent — a guaranteed 23502 for any caller that didn't pass one.
   * Nothing had ever hit it (the table has zero rows in prod and the one caller
   * supplies a non-nullable WorkspaceContext.orgId), so the type was free to
   * promise something the database refuses. Verified against the real schema
   * with a BEGIN…ROLLBACK probe.
   */
  orgId: string;
  workspaceId?: string | null;
  kind: SavedKind;
  title?: string | null;
  body?: string | null;
  mediaUrl?: string | null;
  caption?: string | null;
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
  sourceCampaignId?: string | null;
  sourceAssetId?: string | null;
  note?: string | null;
};

export async function saveItem(
  input: SaveItemInput,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<SavedItem> {
  const { data, error } = await client
    .from("arc_saved_items")
    .insert({
      operator: input.operator,
      org_id: input.orgId,
      ...(input.workspaceId != null ? { workspace_id: input.workspaceId } : {}),
      kind: input.kind,
      title: input.title ?? null,
      body: input.body ?? null,
      media_url: input.mediaUrl ?? null,
      caption: input.caption ?? null,
      source_conversation_id: input.sourceConversationId ?? null,
      source_message_id: input.sourceMessageId ?? null,
      source_campaign_id: input.sourceCampaignId ?? null,
      source_asset_id: input.sourceAssetId ?? null,
      note: input.note ?? null,
    })
    .select(COLUMNS)
    .single<SavedRow>();
  if (error) throw new Error(`arc_saved_items insert: ${error.message}`);
  if (!data) throw new Error("arc_saved_items insert returned no row");
  return toSaved(data);
}

export async function listSavedItems(
  operator: string,
  client: SupabaseClient = getSupabaseAdminClient(),
  opts: { orgId?: string | null } = {},
): Promise<SavedItem[]> {
  let query = client.from("arc_saved_items").select(COLUMNS).eq("operator", operator);
  // Rows are stamped with org_id on save; scope the read to the current workspace
  // so an operator who belongs to more than one org never sees another's saves.
  if (opts.orgId) query = query.eq("org_id", opts.orgId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw new Error(`arc_saved_items list: ${error.message}`);
  return ((data ?? []) as SavedRow[]).map(toSaved);
}

export async function removeSavedItem(
  id: string,
  operator: string,
  client: SupabaseClient = getSupabaseAdminClient(),
  opts: { orgId?: string | null } = {},
): Promise<void> {
  let query = client.from("arc_saved_items").delete().eq("id", id).eq("operator", operator);
  if (opts.orgId) query = query.eq("org_id", opts.orgId);
  const { error } = await query;
  if (error) throw new Error(`arc_saved_items delete: ${error.message}`);
}

export async function getSavedItem(
  id: string,
  operator: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<SavedItem | null> {
  const { data, error } = await client
    .from("arc_saved_items")
    .select(COLUMNS)
    .eq("id", id)
    .eq("operator", operator)
    .maybeSingle<SavedRow>();
  if (error) throw new Error(`arc_saved_items get: ${error.message}`);
  return data ? toSaved(data) : null;
}

export async function markPromoted(
  id: string,
  promoted: { campaignId: string; assetId: string },
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client
    .from("arc_saved_items")
    .update({
      promoted_campaign_id: promoted.campaignId,
      promoted_asset_id: promoted.assetId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`arc_saved_items markPromoted: ${error.message}`);
}
