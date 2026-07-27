import { type SupabaseClient } from "@supabase/supabase-js";

import {
  applyConfidenceFloor,
  DEFAULT_CONFIDENCE_FLOOR,
  dismissCooldownDays,
  type OpportunityCandidate,
} from "@/domain";
import { getCurrentOrgId } from "@/lib/auth/org";
import { type Database } from "@/lib/supabase/database.types";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * `filtered` is how many candidates the confidence floor rejected — present
 * only when something actually was. Reported rather than dropped silently: a
 * scan that quietly discards half its findings reads as "nothing to surface"
 * when the truth is "nothing cleared the bar".
 */
export type PersistResult = { ok: true; count: number; filtered?: number } | { ok: false; error: string };

/** Success payload, carrying `filtered` only when the floor actually rejected something. */
function persisted(count: number, filtered: number): PersistResult {
  return filtered > 0 ? { ok: true, count, filtered } : { ok: true, count };
}

/**
 * Workspace-tunable confidence floor. Env rather than a hardcoded constant so a
 * noisy workspace can be tightened without a code change; unset or unparseable
 * falls back to the domain default.
 */
function confidenceFloor(): number {
  const raw = Number.parseInt(process.env.ARC_OPPORTUNITY_CONFIDENCE_FLOOR ?? "", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_CONFIDENCE_FLOOR;
}

export type MutateResult = { ok: true } | { ok: false; error: string };
export type OpportunityScope = { orgId: string };

const NOT_CONFIGURED = "Supabase isn't configured, so opportunities can't be saved.";
const OPEN_STATUSES = ["pending", "drafting", "drafted"];
/** Statuses that can suppress a re-detected candidate. */
const SUPPRESSING_STATUSES = [...OPEN_STATUSES, "dismissed", "snoozed"];

type SuppressionRow = {
  subject_id: string;
  status: string;
  dismissed_at: string | null;
  snoozed_until: string | null;
};

/**
 * True when an existing row should block re-inserting a candidate for its subject.
 *
 * Dismissing used to mean nothing to the detector — dedup checked only OPEN
 * statuses, so the very next scan re-inserted an identical card and the operator
 * could never actually clear the queue. A cooldown rather than a permanent block
 * because "not relevant right now" is a statement about now: if a lead is still
 * cold in a month, that is worth raising again, but not tomorrow. The cooldown is
 * jittered per-subject so a batch cleared in one sitting doesn't all come back on
 * the same day — see dismissCooldownDays.
 */
function suppresses(row: SuppressionRow, kind: string, now: number): boolean {
  if (OPEN_STATUSES.includes(row.status)) return true;
  // A snooze always suppresses, expired or not: while it runs the operator has
  // asked not to see it, and once it expires the read model wakes the ORIGINAL
  // card — so re-inserting here would show them two of the same signal.
  if (row.status === "snoozed") return true;
  if (row.status === "dismissed") {
    if (!row.dismissed_at) return true;
    const elapsed = now - Date.parse(row.dismissed_at);
    return elapsed < dismissCooldownDays(kind, row.subject_id) * 86_400_000;
  }
  return false;
}

/**
 * Insert new opportunities, dropping anything under the confidence floor and
 * skipping any subject of the same kind that already has an open opportunity, a
 * live snooze, or a recent dismissal (app-level dedup; the partial unique index
 * is the DB safety net). Re-scans therefore neither flood the inbox nor undo the
 * operator's triage.
 *
 * The floor lives here, at the single chokepoint every producer funnels through
 * — deterministic detectors, signal-source connectors, and Arc's propose route —
 * so one bar applies to all of them and no future caller can bypass it.
 */
export async function upsertOpportunities(
  candidates: OpportunityCandidate[],
  client?: SupabaseClient,
  scope?: OpportunityScope,
): Promise<PersistResult> {
  // Guard BEFORE resolving the admin client — a `= getSupabaseAdminClient()`
  // default arg would throw during arg evaluation, defeating this guard.
  if (!isSupabaseAdminConfigured()) return { ok: false, error: NOT_CONFIGURED };
  if (candidates.length === 0) return { ok: true, count: 0 };

  // Quality gate first: below-floor candidates shouldn't cost a dedup round-trip.
  const qualified = applyConfidenceFloor(candidates, confidenceFloor());
  const filtered = candidates.length - qualified.length;
  if (qualified.length === 0) return persisted(0, filtered);

  const db = client ?? getSupabaseAdminClient();
  // Prefer the caller's explicit (token-resolved) org. getCurrentOrgId() falls
  // back to the cookie/default workspace, which is wrong for a headless runner
  // token — see the Arc propose route which now passes its arcGuard scope.
  const orgId = scope?.orgId ?? (await getCurrentOrgId());
  const kind = qualified[0].kind;

  const { data: existing, error: readErr } = await db
    .from("opportunities")
    .select("subject_id, status, dismissed_at, snoozed_until")
    .eq("org_id", orgId)
    .eq("kind", kind)
    .in("status", SUPPRESSING_STATUSES);
  if (readErr) return { ok: false, error: readErr.message };

  const now = Date.now();
  const suppressed = new Set(
    ((existing ?? []) as SuppressionRow[]).filter((row) => suppresses(row, kind, now)).map((row) => row.subject_id),
  );
  const fresh = qualified.filter((c) => !suppressed.has(c.subjectId));
  if (fresh.length === 0) return persisted(0, filtered);

  const rows = fresh.map((c) => ({
    org_id: orgId,
    kind: c.kind,
    subject_type: c.subjectType,
    subject_id: c.subjectId,
    title: c.title,
    summary: c.summary,
    confidence: c.confidence,
    urgency: c.urgency,
    evidence: c.evidence,
    recommended_action: c.recommendedAction,
    recommended_campaign_type: c.recommendedCampaignType,
    status: "pending",
    detected_by: "arc",
  }));
  const { error: insErr } = await db.from("opportunities").insert(rows);
  if (insErr) return { ok: false, error: insErr.message };
  return persisted(rows.length, filtered);
}

/** Typed against the generated row so the update can't drift from the table. */
type OpportunityPatch = Database["public"]["Tables"]["opportunities"]["Update"];

async function setStatus(
  id: string,
  patch: OpportunityPatch,
  client?: SupabaseClient,
  scope?: OpportunityScope,
): Promise<MutateResult> {
  if (!isSupabaseAdminConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const db = client ?? getSupabaseAdminClient();
  const orgId = scope?.orgId ?? await getCurrentOrgId();
  const { error } = await db.from("opportunities").update(patch).eq("org_id", orgId).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export function dismissOpportunity(id: string, client?: SupabaseClient, scope?: OpportunityScope) {
  return setStatus(id, { status: "dismissed", dismissed_at: new Date().toISOString() }, client, scope);
}

export function snoozeOpportunity(id: string, untilIso: string, client?: SupabaseClient, scope?: OpportunityScope) {
  return setStatus(id, { status: "snoozed", snoozed_until: untilIso }, client, scope);
}

export function markOpportunityDrafting(id: string, agentTaskId: string, client?: SupabaseClient, scope?: OpportunityScope) {
  return setStatus(id, { status: "drafting", agent_task_id: agentTaskId }, client, scope);
}

export function markOpportunityDrafted(id: string, campaignId: string, client?: SupabaseClient, scope?: OpportunityScope) {
  return setStatus(id, { status: "drafted", campaign_id: campaignId }, client, scope);
}
