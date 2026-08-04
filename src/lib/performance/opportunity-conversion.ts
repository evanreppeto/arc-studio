import { type SupabaseClient } from "@supabase/supabase-js";

import { buildOpportunityConversion, type OpportunityConversion, type OpportunityConversionFact } from "@/domain";
import { getCurrentOrgId } from "@/lib/auth/org";
import { notConfigured } from "@/lib/observability/unavailable";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { resolveTenantReadHandle } from "@/lib/supabase/tenant-client";

/**
 * Read model for the "what converts" view: joins opportunities (by kind) →
 * their drafted campaigns → approval state → booked outcomes, then rolls the
 * funnel up per kind / persona / urgency. Org-scoped, read-only. Honest states:
 * `unavailable` when Supabase isn't configured, `empty` when the window has no
 * opportunities — never fabricated numbers.
 */

export type OpportunityConversionReadModel =
  | { status: "live"; conversion: OpportunityConversion; windowDays: number }
  | { status: "empty" }
  /** No backend configured — an answer, not an outage. See `notConfigured`. */
  | { status: "not_configured" }
  | { status: "unavailable" };

type OppRow = {
  kind: string | null;
  status: string;
  campaign_id: string | null;
  urgency: "low" | "medium" | "high";
  evidence: { persona?: string } | null;
};

const DRAFTED_STATUSES = new Set(["drafting", "drafted"]);
// A campaign counts as "approved" once it clears the gate or moves live.
const APPROVED_CAMPAIGN_STATUSES = new Set(["approved", "active", "paused"]);

export async function getOpportunityConversion(
  orgId?: string,
  client?: SupabaseClient,
  windowDays = 90,
): Promise<OpportunityConversionReadModel> {
  // Not an outage: there is no database to ask. Reporting this as a failed read
  // put a red "Some analytics couldn't load" banner on every backend-less
  // preview, naming a query that had never run.
  if (!client && !isSupabaseAdminConfigured()) return notConfigured();

  const { client: db, orgId: handleOrgId } = client ? { client, orgId: null } : await resolveTenantReadHandle();
  const resolvedOrgId = orgId ?? handleOrgId ?? (await getCurrentOrgId());
  const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const { data: opps, error } = await db
    .from("opportunities")
    .select("kind, status, campaign_id, urgency, evidence")
    .eq("org_id", resolvedOrgId)
    .gte("created_at", sinceIso);
  if (error) return { status: "unavailable" };
  const rows = (opps ?? []) as OppRow[];
  if (rows.length === 0) return { status: "empty" };

  const campaignIds = [...new Set(rows.map((o) => o.campaign_id).filter((v): v is string => Boolean(v)))];

  const approved = new Set<string>();
  const booked = new Set<string>();
  if (campaignIds.length > 0) {
    const [camps, appr, results] = await Promise.all([
      db.from("campaigns").select("id, status").eq("org_id", resolvedOrgId).in("id", campaignIds),
      db.from("approval_items").select("campaign_id").eq("org_id", resolvedOrgId).eq("status", "approved").in("campaign_id", campaignIds),
      db.from("campaign_results").select("campaign_id, jobs, won_revenue_cents").in("campaign_id", campaignIds),
    ]);
    // These three decide which opportunities count as approved and booked, so a
    // failed read here does not thin the data — it reports that NOTHING
    // converted (BSR-575). On the analytics surface that reads as a real result
    // an operator would act on, and it is the same `unavailable` the primary
    // opportunities read above already returns for its own failure.
    if (camps.error || appr.error || results.error) return { status: "unavailable" };

    for (const c of (camps.data ?? []) as { id: string; status: string }[]) {
      if (APPROVED_CAMPAIGN_STATUSES.has(c.status)) approved.add(c.id);
    }
    for (const a of (appr.data ?? []) as { campaign_id: string | null }[]) {
      if (a.campaign_id) approved.add(a.campaign_id);
    }
    for (const r of (results.data ?? []) as { campaign_id: string; jobs: number | null; won_revenue_cents: number | null }[]) {
      if ((r.jobs ?? 0) > 0 || (r.won_revenue_cents ?? 0) > 0) booked.add(r.campaign_id);
    }
  }

  const facts: OpportunityConversionFact[] = rows.map((o) => {
    const drafted = Boolean(o.campaign_id) || DRAFTED_STATUSES.has(o.status);
    const isBooked = drafted && Boolean(o.campaign_id) && booked.has(o.campaign_id as string);
    // Monotonic funnel: booked ⊆ approved ⊆ drafted.
    const isApproved = isBooked || (drafted && Boolean(o.campaign_id) && approved.has(o.campaign_id as string));
    return {
      kind: o.kind || "other",
      persona: typeof o.evidence?.persona === "string" ? o.evidence.persona : "",
      urgency: o.urgency,
      drafted,
      approved: isApproved,
      booked: isBooked,
    };
  });

  return { status: "live", conversion: buildOpportunityConversion(facts), windowDays };
}
