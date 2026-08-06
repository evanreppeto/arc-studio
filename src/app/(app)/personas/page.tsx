import { isWonStatus, matchPersonaSlug } from "@/domain";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { readPersonas, type Persona } from "@/lib/personas/console";
import { getPipelineStages } from "@/lib/pipeline-stages/read-model";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { PersonasView, type PersonaVM } from "./_components/personas-view";

export const metadata = { title: "Personas — Arc Studio" };

const SEG_COLOR: Record<string, string> = {
  acquisition: "#88b6d8",
  engagement: "#c8a24a",
  retention: "#7fb89a",
};

const STAGE_COLOR: Record<string, { color: string; bg: string }> = {
  "Hot lead": { color: "#e0a3a3", bg: "rgba(204,102,102,.15)" },
  Champion: { color: "#a3d0b8", bg: "rgba(127,184,154,.14)" },
  "Repeat customer": { color: "#a3d0b8", bg: "rgba(127,184,154,.14)" },
  Active: { color: "#ecd596", bg: "rgba(200,162,74,.12)" },
  New: { color: "#9cc1e0", bg: "rgba(136,182,216,.13)" },
  "At risk": { color: "#e6cf8e", bg: "rgba(216,182,94,.14)" },
  Dormant: { color: "var(--text-muted)", bg: "rgba(255,255,255,.04)" },
};

function scoreColor(score: number): string {
  if (score >= 80) return "#7fb89a";
  if (score >= 60) return "#c8a24a";
  return "#d8a24a";
}

type PerfRow = { leads: number; jobs: number; revenueCents: number };

// Driver line for a radar axis — the persona's own signal_drivers when present,
// otherwise a short label keyed off the real signal value.
function driverText(drivers: string[], value: number, kind: "engagement" | "fit" | "intent"): string {
  if (drivers.length) return drivers[0];
  const fallback = {
    engagement: ["Opens & replies trending up", "Room to lift opens & replies"],
    fit: ["Strong match to the ICP", "Partial ICP match"],
    intent: ["Recent buying signals", "Few recent buying signals"],
  }[kind];
  return value >= 70 ? fallback[0] : fallback[1];
}
// Legacy BSR bridge: the demo tenant's persona slug (homeowner-emergency) maps to
// its records' persona key (persona_homeowner_emergency). Per-org personas store
// the slug AS the record key, so perf lookup tries the slug directly first.
const personaEnum = (slug: string) => `persona_${slug.replace(/-/g, "_")}`;

/**
 * Per-persona attributed performance. Returns `failed` when a CRM query ERRORED
 * rather than returned nothing: postgrest reports errors in `{ error }` instead of
 * throwing, so ignoring it turned an RLS denial or a timeout into a confident
 * "0 leads · attributed" that looks exactly like a persona nobody has converted.
 */
async function personaPerf(orgId: string): Promise<{ rows: Map<string, PerfRow>; failed: boolean }> {
  const out = new Map<string, PerfRow>();
  if (!isSupabaseAdminConfigured()) return { rows: out, failed: false };
  const admin = getSupabaseAdminClient();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const bump = (key: string, patch: Partial<PerfRow>) => {
    const cur = out.get(key) ?? { leads: 0, jobs: 0, revenueCents: 0 };
    out.set(key, { leads: cur.leads + (patch.leads ?? 0), jobs: cur.jobs + (patch.jobs ?? 0), revenueCents: cur.revenueCents + (patch.revenueCents ?? 0) });
  };
  // Revenue per persona counts WON outcomes — asked of the org's own stages
  // rather than filtered on the literal keys `["won", "paid"]` in the query.
  // A workspace that renamed its closing stage would have seen every persona's
  // revenue read $0 here, with nothing in the logs to say why (BSR-563).
  const outcomeStages = await getPipelineStages(orgId, "outcomes", { client: admin });
  const [leads, jobs, outcomes] = await Promise.all([
    admin.from("leads").select("persona").eq("org_id", orgId).gte("created_at", since),
    admin.from("jobs").select("persona").eq("org_id", orgId),
    admin.from("outcomes").select("persona, gross_revenue_cents, status").eq("org_id", orgId),
  ]);
  const errors = [leads.error, jobs.error, outcomes.error].filter(Boolean);
  if (errors.length > 0) {
    console.warn(`[personas] perf query failed for org ${orgId} — ${errors.map((e) => e!.message).join("; ")}`);
    return { rows: out, failed: true };
  }
  for (const r of (leads.data ?? []) as { persona: string | null }[]) if (r.persona) bump(r.persona, { leads: 1 });
  for (const r of (jobs.data ?? []) as { persona: string | null }[]) if (r.persona) bump(r.persona, { jobs: 1 });
  for (const r of (outcomes.data ?? []) as { persona: string | null; gross_revenue_cents: number | null; status: string | null }[]) {
    if (r.persona && isWonStatus(outcomeStages, r.status)) bump(r.persona, { revenueCents: r.gross_revenue_cents ?? 0 });
  }
  return { rows: out, failed: false };
}

function money(cents: number): string {
  const d = Math.round(cents / 100);
  return d >= 1000 ? `$${Math.round(d / 1000)}k` : `$${d}`;
}

function toVM(p: Persona, perf: Map<string, PerfRow>, perfFailed: boolean): PersonaVM {
  const segColor = SEG_COLOR[p.segment] ?? "#c8a24a";
  const stage = STAGE_COLOR[p.stage] ?? { color: "#b8b4aa", bg: "rgba(255,255,255,.04)" };
  const share = Math.round(p.audienceShare > 1 ? p.audienceShare : p.audienceShare * 100);
  const radar = p.signals;
  const pr = perf.get(p.slug) ?? perf.get(personaEnum(p.slug)) ?? { leads: 0, jobs: 0, revenueCents: 0 };
  return {
    slug: p.slug,
    name: p.name,
    initials: p.initials,
    segment: p.segment,
    segmentLabel: p.segment.charAt(0).toUpperCase() + p.segment.slice(1),
    segColor,
    stage: p.stage,
    stageColor: stage.color,
    stageBg: stage.bg,
    score: p.score,
    scoreColor: scoreColor(p.score),
    audienceShare: share,
    scoreTrend: p.scoreTrend?.length ? p.scoreTrend : [p.score, p.score],
    live: p.live,
    quote: p.quote,
    profile: p.profile,
    angle: p.angle,
    cta: p.cta,
    nextAction: p.nextAction,
    channel: p.channel,
    bestTiming: p.bestTiming,
    audience: p.audience,
    proofPoints: p.proofPoints ?? [],
    sampleSubject: p.sampleMessage?.subject ?? "",
    samplePreview: p.sampleMessage?.preview ?? "",
    radar,
    drivers: {
      engagement: driverText(p.signalDrivers.engagement, radar.engagement, "engagement"),
      fit: driverText(p.signalDrivers.fit, radar.fit, "fit"),
      intent: driverText(p.signalDrivers.intent, radar.intent, "intent"),
    },
    perf: { leads: pr.leads, jobs: pr.jobs, revenue: money(pr.revenueCents) },
    perfUnavailable: perfFailed,
  };
}

export default async function PersonasPage({ searchParams }: { searchParams: Promise<{ inspect?: string }> }) {
  const [sp, ctx] = await Promise.all([searchParams, getCurrentWorkspaceContext().catch(() => null)]);
  const [personaRead, perf] = await Promise.all([
    // Backstop only — readPersonas already reports and describes its own failure.
    readPersonas().catch(() => ({
      personas: [] as Persona[],
      failed: "We couldn't load your personas. Nothing was changed; refresh to try again.",
    })),
    ctx
      ? personaPerf(ctx.orgId).catch(() => ({ rows: new Map<string, PerfRow>(), failed: true }))
      : Promise.resolve({ rows: new Map<string, PerfRow>(), failed: false }),
  ]);
  const vms = personaRead.personas.map((p) => toVM(p, perf.rows, perf.failed));
  // `?inspect=` (Arc's @-mentions link here) opens the roster on that persona.
  return <PersonasView personas={vms} failed={personaRead.failed} initialSlug={matchPersonaSlug(sp.inspect, vms.map((p) => p.slug))} />;
}
