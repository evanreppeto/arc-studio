import { type SupabaseClient } from "@supabase/supabase-js";
import { reportDegraded } from "@/lib/observability/report-degraded";

import {
  DEMO_PERSONAS,
  type DemoPersona,
  type PersonaArcActivity,
  type PersonaSegmentKey,
  type PersonaStage,
  type ScoreSignalKey,
} from "./demo-personas";
import { getCurrentOrgId } from "@/lib/auth/org";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

/** The persona shape the console renders. Reuses the demo data contract. */
export type Persona = DemoPersona;

const COLUMNS =
  "slug,name,initials,segment,stage,score,signals,signal_drivers,audience_share,score_trend,live,quote,profile,goals,objections,angle,audience,cta,channel,best_timing,next_action,proof_points,sample_message,arc_activity";

type PersonaRow = {
  slug: string;
  name: string;
  initials: string | null;
  segment: string | null;
  stage: string | null;
  score: number | null;
  signals: Partial<Record<ScoreSignalKey, number>> | null;
  signal_drivers: Partial<Record<ScoreSignalKey, string[]>> | null;
  audience_share: number | null;
  score_trend: number[] | null;
  live: boolean | null;
  quote: string | null;
  profile: string | null;
  goals: string[] | null;
  objections: string[] | null;
  angle: string | null;
  audience: string | null;
  cta: string | null;
  channel: string | null;
  best_timing: string | null;
  next_action: string | null;
  proof_points: string[] | null;
  sample_message: { subject?: string; preview?: string } | null;
  arc_activity: PersonaArcActivity[] | null;
};

const SEGMENTS: PersonaSegmentKey[] = ["acquisition", "engagement", "retention"];
const STAGES: PersonaStage[] = ["New", "Hot lead", "Active", "Champion", "At risk", "Dormant"];

function mapRow(row: PersonaRow): Persona {
  const segment = SEGMENTS.includes(row.segment as PersonaSegmentKey) ? (row.segment as PersonaSegmentKey) : "acquisition";
  const stage = STAGES.includes(row.stage as PersonaStage) ? (row.stage as PersonaStage) : "New";
  const score = clampScore(row.score ?? 50);
  return {
    slug: row.slug,
    name: row.name,
    initials: row.initials || initialsFrom(row.name),
    segment,
    stage,
    score,
    signals: {
      engagement: row.signals?.engagement ?? score,
      fit: row.signals?.fit ?? score,
      intent: row.signals?.intent ?? score,
    },
    signalDrivers: {
      engagement: row.signal_drivers?.engagement ?? [],
      fit: row.signal_drivers?.fit ?? [],
      intent: row.signal_drivers?.intent ?? [],
    },
    audienceShare: row.audience_share ?? 0,
    scoreTrend: row.score_trend?.length ? row.score_trend : [score, score],
    live: row.live ?? false,
    quote: row.quote ?? "",
    profile: row.profile ?? "",
    goals: row.goals ?? [],
    objections: row.objections ?? [],
    angle: row.angle ?? "",
    audience: row.audience ?? "",
    cta: row.cta ?? "",
    channel: row.channel ?? "",
    bestTiming: row.best_timing ?? "",
    nextAction: row.next_action ?? "",
    proofPoints: row.proof_points ?? [],
    sampleMessage: { subject: row.sample_message?.subject ?? "", preview: row.sample_message?.preview ?? "" },
    arcActivity: row.arc_activity ?? [],
  };
}

/**
 * Personas for the current org. Returns the neutral demo set when Supabase
 * isn't configured or the org has none yet, so the console is never empty.
 */
export async function listPersonas(): Promise<Persona[]> {
  return (await readPersonas()).personas;
}

/**
 * As `listPersonas`, but says whether the read actually succeeded.
 *
 * The bare `catch` this replaces turned an RLS denial or a timeout into an empty
 * list, and /personas rendered that as "no personas yet" — a confident claim
 * about a workspace we had failed to ask. That is the identical failure the
 * SAME page already guards against for its attributed-performance numbers
 * (BSR-563, which returns `failed` precisely so a broken query cannot read as
 * "nobody converted"). The list underneath it kept the bug the numbers lost.
 *
 * Demo data is still returned on failure when the offline preview is on: there
 * it is illustrative content, not a claim about a real workspace.
 */
export async function readPersonas(): Promise<{ personas: Persona[]; failed: string | null }> {
  // Not configured is an ANSWER, not an outage (BSR-546).
  if (!isSupabaseAdminConfigured()) return { personas: isDemoDataEnabled() ? DEMO_PERSONAS : [], failed: null };
  try {
    const orgId = await getCurrentOrgId();
    // `personas` isn't in the generated types yet — use an untyped client.
    const supabase = getSupabaseAdminClient() as unknown as SupabaseClient;
    const { data, error } = await supabase.from("personas").select(COLUMNS).eq("org_id", orgId).eq("is_active", true).order("score", { ascending: false });
    if (error) throw error;
    if (!data || data.length === 0) {
      if (isDemoDataEnabled()) return { personas: DEMO_PERSONAS, failed: null };
      return { personas: [], failed: null };
    }
    return { personas: (data as PersonaRow[]).map(mapRow), failed: null };
  } catch (error) {
    reportDegraded(error, { scope: "personas.readPersonas", surface: "primary" });
    if (isDemoDataEnabled()) return { personas: DEMO_PERSONAS, failed: null };
    return { personas: [], failed: "We couldn't load your personas. Nothing was changed; refresh to try again." };
  }
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
