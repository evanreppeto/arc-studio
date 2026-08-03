import { type SupabaseClient } from "@supabase/supabase-js";

import { redactDeep, redactSecrets } from "@/domain";
import { type ApprovalCard, listApprovalCards } from "@/lib/approvals/read-model";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { type ArcTenantScope } from "./drafts";
import { workspaceScopeFields } from "@/lib/tenancy/write-scope";

/**
 * Arc Operations API approvals layer.
 *
 * SAFETY: Arc may READ approvals and ADD a recommendation, but never decides.
 * `addApprovalRecommendation` writes to `approval_recommendations` ONLY — it
 * does not touch `approval_items.status`, never inserts into the
 * `approval_decisions` ledger, and never calls the human decision path
 * (`@/lib/approvals/decisions`). Outbound stays locked behind the human gate.
 */

// Every approval_status enum value — used so getApprovalForApi can resolve an
// item regardless of where it sits in the workflow (not just active states).
const ALL_APPROVAL_STATUSES = [
  "draft",
  "needs_compliance",
  "pending_approval",
  "pending_owner_approval",
  "approved",
  "declined",
  "rejected",
  "revision_requested",
  "blocked",
  "needs_revision",
  "archived",
];

export async function listApprovalsForApi(
  filter: { statuses?: string[]; limit?: number } = {},
  client?: SupabaseClient,
  scope?: ArcTenantScope,
): Promise<ApprovalCard[]> {
  return listApprovalCards(
    { statuses: filter.statuses, limit: filter.limit, orgId: scope?.orgId },
    client ?? getSupabaseAdminClient(),
  );
}

export type ApprovalRecommendation = {
  id: string;
  agent: string;
  recommendation: string;
  rationale: string | null;
  riskFlags: string[];
  suggestedEdits: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type RecommendationRow = {
  id: string;
  agent: string | null;
  recommendation: string;
  rationale: string | null;
  risk_flags: string[] | null;
  suggested_edits: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function mapRecommendation(row: RecommendationRow): ApprovalRecommendation {
  return {
    id: row.id,
    agent: row.agent ?? "arc",
    recommendation: row.recommendation,
    rationale: row.rationale,
    riskFlags: row.risk_flags ?? [],
    suggestedEdits: row.suggested_edits,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

/**
 * Read Arc's recommendations for an approval item, newest first. Defensive:
 * if the `approval_recommendations` table isn't present yet (migration not
 * applied), returns [] so approval reads keep working.
 */
export async function listApprovalRecommendations(
  approvalItemId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
  scope?: ArcTenantScope,
): Promise<ApprovalRecommendation[]> {
  try {
    const { data, error } = await applyOrgScope(
      client
        .from("approval_recommendations")
        .select("*")
        .eq("approval_item_id", approvalItemId),
      scope,
    ).order("created_at", { ascending: false });
    if (error) {
      return [];
    }
    return ((data ?? []) as RecommendationRow[]).map(mapRecommendation);
  } catch {
    return [];
  }
}

export type ApprovalDetail = ApprovalCard & { recommendations: ApprovalRecommendation[] };

export async function getApprovalForApi(id: string, client?: SupabaseClient, scope?: ArcTenantScope): Promise<ApprovalDetail | null> {
  const supabase = client ?? getSupabaseAdminClient();
  const cards = await listApprovalCards({ statuses: ALL_APPROVAL_STATUSES, limit: 500, orgId: scope?.orgId }, supabase);
  const card = cards.find((entry) => entry.id === id);
  if (!card) {
    return null;
  }
  const recommendations = await listApprovalRecommendations(id, supabase, scope);
  return { ...card, recommendations };
}

export type AddRecommendationInput = {
  approvalItemId: string;
  agent?: string;
  recommendation: string;
  rationale?: string | null;
  riskFlags?: string[];
  suggestedEdits?: string | null;
  metadata?: Record<string, unknown>;
};

export type AddRecommendationResult =
  | { ok: true; recommendationId: string }
  | { ok: false; reason: "not_found" };

export async function addApprovalRecommendation(
  input: AddRecommendationInput,
  client: SupabaseClient = getSupabaseAdminClient(),
  scope?: ArcTenantScope,
): Promise<AddRecommendationResult> {
  // Validate the target exists (read-only) so a bad id 404s instead of failing
  // an FK insert. This is the ONLY read of approval_items here.
  const { data: item, error: lookupError } = await applyOrgScope(
    client
      .from("approval_items")
      .select("id")
      .eq("id", input.approvalItemId),
    scope,
  ).maybeSingle();
  if (lookupError) {
    throw new Error(`approval lookup failed: ${lookupError.message}`);
  }
  if (!item) {
    return { ok: false, reason: "not_found" };
  }

  const { data, error } = await client
    .from("approval_recommendations")
    .insert({
      ...workspaceScopeFields(scope),
      approval_item_id: input.approvalItemId,
      agent: input.agent ?? "arc",
      recommendation: redactSecrets(input.recommendation),
      rationale: input.rationale ? redactSecrets(input.rationale) : null,
      risk_flags: input.riskFlags ?? [],
      suggested_edits: input.suggestedEdits ? redactSecrets(input.suggestedEdits) : null,
      metadata: redactDeep(input.metadata ?? {}) as Record<string, unknown>,
    })
    .select("id")
    .single();
  if (error) {
    throw new Error(`addApprovalRecommendation insert failed: ${error.message}`);
  }
  return { ok: true, recommendationId: (data as { id: string }).id };
}

function applyOrgScope<Query>(query: Query, scope?: ArcTenantScope): Query {
  if (!scope) return query;
  return (query as { eq(column: string, value: string): Query }).eq("org_id", scope.orgId);
}

