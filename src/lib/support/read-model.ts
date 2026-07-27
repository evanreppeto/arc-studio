import { type SupabaseClient } from "@supabase/supabase-js";

import {
  supportCategoryLabel,
  supportImpactLabel,
  supportReferenceCode,
  supportStatusMeta,
  type SupportStatus,
} from "@/domain";

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

export type SupportRequestView = {
  id: string;
  reference: string;
  subject: string;
  body: string;
  categoryLabel: string;
  impactLabel: string;
  status: SupportStatus;
  statusLabel: string;
  statusTone: "warn" | "blue" | "ok" | "muted";
  pagePath: string;
  submittedBy: string;
  createdAt: string;
  resolutionNote: string;
};

type SupportRow = {
  id: string;
  subject: string;
  body: string;
  category: string;
  impact: string;
  status: string;
  page_path: string | null;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  resolution_note: string | null;
  created_at: string;
};

function toView(row: SupportRow): SupportRequestView {
  const status = row.status as SupportStatus;
  const meta = supportStatusMeta(status);
  return {
    id: row.id,
    reference: supportReferenceCode(row.id),
    subject: row.subject,
    body: row.body,
    categoryLabel: supportCategoryLabel(row.category),
    impactLabel: supportImpactLabel(row.impact),
    status,
    statusLabel: meta.label,
    statusTone: meta.tone,
    pagePath: row.page_path ?? "",
    submittedBy: row.submitted_by_name || row.submitted_by_email || "A teammate",
    createdAt: row.created_at,
    resolutionNote: row.resolution_note ?? "",
  };
}

/**
 * The workspace's own recent support requests, newest first. Degrades to an
 * empty list whenever there's no tenant, no Supabase, or the table hasn't been
 * migrated yet — the support page must render even when everything else is
 * broken, since that's exactly when someone needs it.
 */
export async function listSupportRequests(orgId: string | null, limit = 12): Promise<SupportRequestView[]> {
  if (!orgId || !isSupabaseAdminConfigured()) return [];
  try {
    // Untyped client — `support_requests` isn't in the generated database.types
    // yet (same convention as the settings/vault layers).
    const supabase: SupabaseClient = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("support_requests")
      .select("id,subject,body,category,impact,status,page_path,submitted_by_name,submitted_by_email,resolution_note,created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as SupportRow[]).map(toView);
  } catch {
    return [];
  }
}
