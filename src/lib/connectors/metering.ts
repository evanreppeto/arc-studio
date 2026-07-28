import { type SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_SPEND_CAP_CENTS,
  METERING_PRICING_VERSION,
  bypassesMetering,
  clampSpendCapCents,
  computeSpendDecision,
  describeConnectorCost,
  estimateConnectorCostCents,
  findConnector,
  formatCents,
  type ConnectorCostTier,
} from "@/domain";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Connector cost governance — the ONE enforcement module (BSR-372). The pure math
// lives in src/domain/connector-metering.ts; this layer does the I/O: reads the
// workspace spend cap + period spend, decides whether a metered call may run, and
// records a usage row after it does. It is wired centrally into the connector run
// path (src/lib/connectors/detection.ts) — never per-connector — so every metered
// connector, present and future, is governed by the same guard.
//
// GUARDRAIL: spending money is an outbound-class action. A call that would push
// spend past the cap is REFUSED with no usage written — it never silently
// overspends. The operator raises the cap (their explicit "approve $X more"
// decision) to unlock it. `free` / `byo_key` connectors bypass this entirely and
// are asserted to never write a usage row.
// ---------------------------------------------------------------------------

/** Start of the current billing period (calendar month, UTC) as an ISO string. */
export function periodStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

/** Untyped admin client — connector_* tables aren't in the generated Database types. */
function adminDb(client?: SupabaseClient): SupabaseClient {
  return (client ?? getSupabaseAdminClient()) as unknown as SupabaseClient;
}

// --- Spend cap (per-workspace, configurable) -------------------------------

/** The workspace's configured metered-spend cap in cents; DEFAULT when unset. */
export async function getSpendCapCents(client: SupabaseClient, workspaceId: string): Promise<number> {
  const { data, error } = await adminDb(client)
    .from("connector_spend_budgets")
    .select("cap_cents")
    .eq("workspace_id", workspaceId)
    .maybeSingle<{ cap_cents: number }>();
  if (error || !data) return DEFAULT_SPEND_CAP_CENTS;
  // Clamped on READ as well as write. A row stored before the platform ceiling
  // existed — or written by any path that bypasses setSpendCapCents — would
  // otherwise keep authorising spend above it indefinitely.
  return clampSpendCapCents(data.cap_cents ?? DEFAULT_SPEND_CAP_CENTS);
}

/**
 * Set the workspace's metered-spend cap. RAISING this is the operator's explicit
 * approval of more spend — it unlocks calls the cap was refusing.
 *
 * Clamped into [0, MAX_WORKSPACE_SPEND_CAP_CENTS]. The ceiling is the backstop
 * for the failure this field invites: a units mistake in the Settings input
 * authorising orders of magnitude more real spend than intended.
 */
export async function setSpendCapCents(
  client: SupabaseClient,
  input: { workspaceId: string; orgId: string | null; capCents: number; updatedBy?: string | null },
): Promise<void> {
  const capCents = clampSpendCapCents(input.capCents);
  const { error } = await adminDb(client).from("connector_spend_budgets").upsert(
    {
      workspace_id: input.workspaceId,
      org_id: input.orgId,
      cap_cents: capCents,
      period: "monthly",
      updated_by: input.updatedBy ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
  if (error) throw new Error(`connector_spend_budgets upsert: ${error.message}`);
}

/** Cents spent on metered connectors this billing period for the workspace. */
export async function getPeriodSpendCents(
  client: SupabaseClient,
  workspaceId: string,
  now: Date = new Date(),
): Promise<number> {
  const { data, error } = await adminDb(client)
    .from("connector_usage_events")
    .select("cost_estimate_cents")
    .eq("workspace_id", workspaceId)
    .gte("occurred_at", periodStartIso(now));
  if (error || !data) return 0;
  return (data as Array<{ cost_estimate_cents: number }>).reduce((sum, r) => sum + (r.cost_estimate_cents ?? 0), 0);
}

// --- Recording usage -------------------------------------------------------

export type RecordConnectorUsageResult =
  | { recorded: true; id: string; costCents: number }
  | { recorded: false; reason: "not_configured" | "error" };

/**
 * Write one billable metered call to the usage ledger. GUARDRAIL: a connector that
 * bypasses metering (free / byo_key) must never reach here — this throws for it, so
 * misuse is loud in tests. Best-effort on I/O (returns a result, never throws) so a
 * ledger blip can't break a detection run. No-ops when Supabase is unconfigured.
 */
export async function recordConnectorUsage(
  client: SupabaseClient | undefined,
  input: {
    orgId: string | null;
    workspaceId: string;
    connectorKey: string;
    units: number;
    context?: Record<string, unknown>;
    /** Resolved tier for dual-mode connectors (platform-key calls are metered
     *  even when the entry's static tier is byo_key). Omitted = static tier. */
    costTier?: ConnectorCostTier;
  },
): Promise<RecordConnectorUsageResult> {
  const entry = findConnector(input.connectorKey);
  if (!entry || bypassesMetering(input.costTier ?? entry.costTier)) {
    throw new Error(
      `recordConnectorUsage called for non-metered connector "${input.connectorKey}" — free/byo_key connectors must bypass metering.`,
    );
  }
  if (!isSupabaseAdminConfigured()) return { recorded: false, reason: "not_configured" };

  const units = Math.max(0, Math.floor(input.units));
  const costCents = estimateConnectorCostCents(input.connectorKey, units);
  try {
    const { data, error } = await adminDb(client)
      .from("connector_usage_events")
      .insert({
        org_id: input.orgId,
        workspace_id: input.workspaceId,
        connector_key: input.connectorKey,
        units,
        cost_estimate_cents: costCents,
        context: input.context ?? {},
        metadata: { pricing_version: METERING_PRICING_VERSION },
        occurred_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) {
      console.warn(`[connector-metering] recordConnectorUsage insert failed: ${error?.message ?? "no row"}`);
      return { recorded: false, reason: "error" };
    }
    return { recorded: true, id: (data as { id: string }).id, costCents };
  } catch (err) {
    console.warn(`[connector-metering] recordConnectorUsage threw: ${err instanceof Error ? err.message : String(err)}`);
    return { recorded: false, reason: "error" };
  }
}

// --- Authorization ---------------------------------------------------------

export type MeteredAuthorization =
  | { authorized: true; bypassed: boolean; estimatedCostCents: number; capCents: number; spentCents: number; remainingCents: number }
  | {
      authorized: false;
      reason: "cap_exceeded";
      needsApproval: true;
      estimatedCostCents: number;
      capCents: number;
      spentCents: number;
      remainingCents: number;
      overByCents: number;
      message: string;
    };

/**
 * Decide whether a metered call may run — WITHOUT running or recording anything.
 * `free` / `byo_key` connectors short-circuit to authorized+bypassed. For a metered
 * connector it reads the cap + period spend and applies computeSpendDecision. A
 * refusal carries the amounts and a human-readable "approve $X more" message.
 */
export async function authorizeMeteredCall(
  client: SupabaseClient | undefined,
  input: {
    workspaceId: string;
    connectorKey: string;
    estimatedUnits: number;
    now?: Date;
    /** Resolved tier for dual-mode connectors — see recordConnectorUsage. */
    costTier?: ConnectorCostTier;
  },
): Promise<MeteredAuthorization> {
  const entry = findConnector(input.connectorKey);
  const tier: ConnectorCostTier = input.costTier ?? entry?.costTier ?? "free";
  const estimatedCostCents = estimateConnectorCostCents(input.connectorKey, input.estimatedUnits);

  if (!entry || bypassesMetering(tier)) {
    return { authorized: true, bypassed: true, estimatedCostCents: 0, capCents: 0, spentCents: 0, remainingCents: 0 };
  }

  // No backend = no ledger to read a cap or spend from, and recordConnectorUsage
  // no-ops for the same reason. Authorize as bypassed rather than throwing —
  // mirrors every other graceful-degrade path when Supabase isn't configured.
  // An explicitly injected client is honored regardless (tests, scoped callers).
  if (!client && !isSupabaseAdminConfigured()) {
    return { authorized: true, bypassed: true, estimatedCostCents, capCents: 0, spentCents: 0, remainingCents: 0 };
  }

  const now = input.now ?? new Date();
  const [capCents, spentCents] = await Promise.all([
    getSpendCapCents(adminDb(client), input.workspaceId),
    getPeriodSpendCents(adminDb(client), input.workspaceId, now),
  ]);

  const decision = computeSpendDecision({ spentCents, capCents, estimatedCostCents });
  if (decision.allow) {
    return {
      authorized: true,
      bypassed: false,
      estimatedCostCents,
      capCents,
      spentCents,
      remainingCents: decision.remainingCents,
    };
  }

  const disclosure = describeConnectorCost(input.connectorKey);
  return {
    authorized: false,
    reason: "cap_exceeded",
    needsApproval: true,
    estimatedCostCents,
    capCents,
    spentCents,
    remainingCents: decision.remainingCents,
    overByCents: decision.overByCents,
    message:
      `${entry.label}: this run (~${formatCents(estimatedCostCents)}${disclosure ? `, ${disclosure}` : ""}) would exceed your ` +
      `${formatCents(capCents)} spend cap — ${formatCents(decision.remainingCents)} left this period. ` +
      `Approve ${formatCents(decision.overByCents)} more in Settings → Usage to run it.`,
  };
}

// --- Central wrapper -------------------------------------------------------

export type MeterCallOutcome<T> =
  | { ok: true; metered: boolean; result: T; costCents: number }
  | { ok: false; metered: true; refusal: Extract<MeteredAuthorization, { authorized: false }> };

/**
 * The central metered-call guard. Wrap ANY connector call that could cost money:
 *   • free / byo_key → runs `run()` directly, records nothing (metered:false).
 *   • metered, under cap → runs `run()`, then records actual usage.
 *   • metered, would exceed cap → REFUSES: `run()` never fires, nothing is spent.
 *
 * `estimatedUnits` prices the run for the cap check up front. `unitsFromResult`
 * (optional) derives the actual billable units to record from the result; when
 * omitted, actual == estimated. This is the only place the run path needs to call
 * to be fully governed.
 */
export async function meterConnectorCall<T>(
  client: SupabaseClient | undefined,
  params: {
    orgId: string | null;
    workspaceId: string;
    connectorKey: string;
    estimatedUnits: number;
    context?: Record<string, unknown>;
    now?: Date;
    /**
     * The RESOLVED cost tier for dual-mode connectors (from
     * resolveConnectorCredential / effectiveCostTier): a call on the platform
     * key is metered even though the entry's static tier says byo_key.
     * Omitted = the entry's static tier, the historical behaviour.
     */
    costTier?: ConnectorCostTier;
    /**
     * Billable units to record when `run()` throws. Default 0 — most failures
     * cost nothing. Return > 0 only where the provider genuinely bills for the
     * failed attempt; guessing here overcharges the customer.
     */
    unitsOnFailure?: (error: unknown) => number;
  },
  run: () => Promise<T> | T,
  unitsFromResult?: (result: T) => number,
): Promise<MeterCallOutcome<T>> {
  const entry = findConnector(params.connectorKey);
  const tier: ConnectorCostTier = params.costTier ?? entry?.costTier ?? "free";

  // Free / byo_key: no governance, no ledger row — the bypass path.
  if (!entry || bypassesMetering(tier)) {
    return { ok: true, metered: false, result: await run(), costCents: 0 };
  }

  const auth = await authorizeMeteredCall(client, {
    workspaceId: params.workspaceId,
    connectorKey: params.connectorKey,
    estimatedUnits: params.estimatedUnits,
    now: params.now,
    costTier: tier,
  });
  if (!auth.authorized) {
    return { ok: false, metered: true, refusal: auth };
  }

  let result: T;
  try {
    result = await run();
  } catch (error) {
    // A failed run can still have cost us: some providers bill the moment they
    // accept a job, so an error thrown afterwards is a real charge. Before this,
    // `run()` was unwrapped — the throw propagated, `recordConnectorUsage` never
    // fired, and the spend went unrecorded. The workspace's period total then
    // understated reality and the cap under-protected by exactly that amount.
    //
    // Whether a given failure was billable is provider-specific, so the caller
    // decides via `unitsOnFailure`; the default is 0 (charge nothing), which
    // preserves the previous behaviour — but now as a deliberate choice rather
    // than an oversight. Attributing cost to failures accurately needs
    // provider-level signal (BSR-502).
    const failedUnits = params.unitsOnFailure?.(error) ?? 0;
    if (failedUnits > 0) {
      await recordConnectorUsage(client, {
        orgId: params.orgId,
        workspaceId: params.workspaceId,
        connectorKey: params.connectorKey,
        units: failedUnits,
        context: { ...params.context, outcome: "failed" },
        costTier: tier,
      });
    }
    throw error;
  }

  const actualUnits = unitsFromResult ? unitsFromResult(result) : params.estimatedUnits;
  const rec = await recordConnectorUsage(client, {
    orgId: params.orgId,
    workspaceId: params.workspaceId,
    connectorKey: params.connectorKey,
    units: actualUnits,
    context: params.context,
    costTier: tier,
  });
  return { ok: true, metered: true, result, costCents: rec.recorded ? rec.costCents : 0 };
}
