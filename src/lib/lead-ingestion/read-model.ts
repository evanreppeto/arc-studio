import { type SupabaseClient } from "@supabase/supabase-js";
import { reportDegraded } from "@/lib/observability/report-degraded";

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/server";
import { type Tables } from "../supabase/database.types";

export type IntakeTone = "green" | "amber" | "red" | "blue" | "gray";

export type IntakeLead = {
  id: string;
  code: string;
  name: string;
  contact: string;
  persona: string;
  source: string;
  receivedAt: string;
  status: string;
  statusLabel: string;
  need: string;
  score: number;
  recommendation: string;
  tone: IntakeTone;
  action: string;
  isTarget: boolean;
};

export type IntakeFunnelStage = { key: string; label: string; count: number; description: string };
export type IntakeSource = { label: string; value: number; share: string };
export type IntakeStat = { label: string; value: number; delta: string; tone: "green" | "amber" | "red" };

export type LeadIngestionData =
  | {
      status: "live";
      leads: IntakeLead[];
      funnel: IntakeFunnelStage[];
      sources: IntakeSource[];
      stats: IntakeStat[];
    }
  | { status: "unavailable"; message: string };

type LeadRow = Pick<
  Tables<"leads">,
  | "id"
  | "company_id"
  | "contact_id"
  | "persona"
  | "status"
  | "routing_recommendation"
  | "source"
  | "loss_summary"
  | "loss_signals"
  | "lead_score"
  | "received_at"
  | "updated_at"
>;

const FUNNEL_STAGES: Array<{ key: string; label: string; description: string }> = [
  { key: "new", label: "New", description: "Just arrived — not yet validated." },
  { key: "needs_review", label: "Needs review", description: "Held for a human validation check." },
  { key: "validated", label: "Validated", description: "Passed intake validation." },
  { key: "qualified", label: "Qualified", description: "Ready for ops or opportunity." },
  { key: "converted", label: "Converted", description: "Became a job or outcome." },
];

export async function getLeadIngestionData(client?: SupabaseClient): Promise<LeadIngestionData> {
  if (!client && !isSupabaseAdminConfigured()) {
    return { status: "unavailable", message: "Supabase env vars are not configured." };
  }

  try {
    const supabase = client ?? getSupabaseAdminClient();

    const leadsResult = await supabase
      .from("leads")
      .select("id,company_id,contact_id,persona,status,routing_recommendation,source,loss_summary,loss_signals,lead_score,received_at,updated_at")
      .order("received_at", { ascending: false })
      .limit(80);
    assertOk("leads", leadsResult.error);
    const leads = (leadsResult.data ?? []) as LeadRow[];

    const contactIds = ids(leads.map((lead) => lead.contact_id));
    const companyIds = ids(leads.map((lead) => lead.company_id));

    const [contactsResult, companiesResult] = await Promise.all([
      supabase.from("contacts").select("id,first_name,last_name,full_name,email").in("id", contactIds),
      supabase.from("companies").select("id,name").in("id", companyIds),
    ]);
    assertOk("contacts", contactsResult.error);
    assertOk("companies", companiesResult.error);

    const contactById = new Map((contactsResult.data ?? []).map((row) => [row.id, row]));
    const companyById = new Map((companiesResult.data ?? []).map((row) => [row.id, row]));

    const mapped = leads.map((lead): IntakeLead => {
      const contact = lead.contact_id ? contactById.get(lead.contact_id) : undefined;
      const company = lead.company_id ? companyById.get(lead.company_id) : undefined;
      const isTarget = lead.routing_recommendation === "target" || lead.routing_recommendation === "elevated";

      return {
        id: lead.id,
        code: `L-${lead.id.slice(0, 6).toUpperCase()}`,
        name: lead.loss_summary ?? titleize(lead.source ?? "Lead"),
        contact: contactName(contact) ?? company?.name ?? "Unassigned contact",
        persona: titleize(lead.persona ?? "Lead"),
        source: titleize(lead.source ?? "Unknown"),
        receivedAt: lead.received_at ?? lead.updated_at ?? "",
        status: lead.status ?? "new",
        statusLabel: titleize(lead.status ?? "new"),
        need: lead.loss_summary ?? (lead.loss_signals?.[0] ? titleize(lead.loss_signals[0]) : "Loss reported"),
        score: lead.lead_score ?? 0,
        recommendation: lead.routing_recommendation ?? "target",
        tone: toneForStatus(lead.status ?? "new"),
        action: isTarget ? "Route to mitigation" : "Hold / review",
        isTarget,
      };
    });

    const countByStatus = (status: string) => mapped.filter((lead) => lead.status === status).length;
    const needsReview = mapped.filter((lead) => lead.status === "new" || lead.status === "needs_review").length;
    const targetWater = mapped.filter((lead) => lead.isTarget).length;
    const converted = countByStatus("converted");

    return {
      status: "live",
      leads: mapped,
      funnel: FUNNEL_STAGES.map((stage) => ({ ...stage, count: countByStatus(stage.key) })),
      sources: buildSourceMix(mapped),
      stats: [
        { label: "Leads in intake", value: mapped.length, delta: "Live records", tone: "green" },
        { label: "Needs review", value: needsReview, delta: "Awaiting validation", tone: "amber" },
        { label: "Target water losses", value: targetWater, delta: "Mitigation-ready", tone: "green" },
        { label: "Converted", value: converted, delta: "Became jobs", tone: "green" },
      ],
    };
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "lead-ingestion.getLeadIngestionData", surface: "primary" });
    return { status: "unavailable", message: error instanceof Error ? error.message : "Lead intake data is unavailable." };
  }
}

function buildSourceMix(leads: IntakeLead[]): IntakeSource[] {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    counts.set(lead.source, (counts.get(lead.source) ?? 0) + 1);
  }
  const total = leads.length || 1;
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, value]) => ({ label, value, share: `${Math.round((value / total) * 100)}%` }));
}

function ids(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function contactName(contact?: { full_name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null }) {
  if (!contact) return undefined;
  return contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email || undefined;
}

function toneForStatus(status: string): IntakeTone {
  if (["validated", "qualified", "converted"].includes(status)) return "green";
  if (["lost", "archived"].includes(status)) return "red";
  if (status === "needs_review") return "amber";
  return "blue";
}

function titleize(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function assertOk(table: string, error: { message?: string } | null) {
  if (error) {
    throw new Error(`${table} lookup failed: ${error.message ?? "Unknown Supabase error"}`);
  }
}
