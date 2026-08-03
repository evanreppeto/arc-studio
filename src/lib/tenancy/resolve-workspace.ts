import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve a workspace for a write that only has an org (BSR-720).
 *
 * Several insert sites into the Wave 1 tables carry an `orgId` and no workspace —
 * `media-library/approval.ts`, `gallery/results-persistence.ts`,
 * `dispatch/execute-resend.ts`, `campaigns/draft-editing.ts`. Threading a new
 * argument through four call chains would touch far more code than the problem
 * warrants, and every one of them already has a *parent* whose workspace is the
 * right answer.
 *
 * So this mirrors the backfill: derive from the parent row where one exists, and
 * fall back to the org's sole workspace only when there is genuinely nothing to
 * derive from. Same precedence, same result — a row written today lands where the
 * migration would have put it.
 *
 * Returns null rather than throwing. The column is nullable during Phase A, and a
 * resolver failure must not take down an approval decision or a dispatch log; a
 * NULL is visible to BSR-711's gate, which is exactly where it should surface.
 */

export type WorkspaceParents = {
  campaignId?: string | null;
  approvalItemId?: string | null;
  campaignAssetId?: string | null;
};

async function lookup(
  client: SupabaseClient,
  table: string,
  id: string,
  orgId: string,
): Promise<string | null> {
  try {
    const { data } = await client
      .from(table)
      .select("workspace_id")
      .eq("id", id)
      .eq("org_id", orgId)
      .maybeSingle<{ workspace_id: string | null }>();
    return data?.workspace_id ?? null;
  } catch {
    return null;
  }
}

/**
 * The org's only workspace. Sound because no product path creates a second
 * workspace inside an existing org — `createWorkspaceForAuthenticatedUser` calls
 * `createOrganizationUnique` first, so every new workspace arrives with its own
 * org (see `docs/GROUP-A-MIGRATION.md`, finding 1). Deliberately refuses to guess
 * when that stops being true.
 */
export async function soleWorkspaceIdForOrg(client: SupabaseClient, orgId: string): Promise<string | null> {
  try {
    const { data } = await client.from("workspaces").select("id").eq("org_id", orgId).limit(2);
    const rows = (data ?? []) as Array<{ id: string }>;
    return rows.length === 1 ? rows[0].id : null;
  } catch {
    return null;
  }
}

/**
 * Most specific parent first, then the org's sole workspace. The order matches
 * the Wave 1 backfill so a row written now and a row backfilled then agree.
 */
export async function resolveWorkspaceId(
  client: SupabaseClient,
  orgId: string,
  parents: WorkspaceParents = {},
): Promise<string | null> {
  if (parents.approvalItemId) {
    const found = await lookup(client, "approval_items", parents.approvalItemId, orgId);
    if (found) return found;
  }
  if (parents.campaignAssetId) {
    const found = await lookup(client, "campaign_assets", parents.campaignAssetId, orgId);
    if (found) return found;
  }
  if (parents.campaignId) {
    const found = await lookup(client, "campaigns", parents.campaignId, orgId);
    if (found) return found;
  }
  return soleWorkspaceIdForOrg(client, orgId);
}

/** Spreadable `{ workspace_id }`, or `{}` when nothing resolved. */
export async function workspaceIdFields(
  client: SupabaseClient,
  orgId: string,
  parents: WorkspaceParents = {},
): Promise<Record<string, string>> {
  const workspaceId = await resolveWorkspaceId(client, orgId, parents);
  return workspaceId ? { workspace_id: workspaceId } : {};
}
