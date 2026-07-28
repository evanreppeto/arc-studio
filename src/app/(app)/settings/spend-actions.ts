"use server";

import { revalidatePath } from "next/cache";

import { MAX_WORKSPACE_SPEND_CAP_CENTS, formatCents } from "@/domain";
import { requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { setSpendCapCents } from "@/lib/connectors/metering";

import type { SettingsWriteResult } from "./actions";

/**
 * Set the per-workspace metered-connector spend cap (BSR-372). RAISING the cap is
 * the operator's explicit "approve $X more spend" decision — it unlocks metered
 * calls the cap was refusing. Spending is an outbound-class action, so this is
 * gated by requireOperator() just like the connect/send actions. Input is whole
 * dollars from the Usage cap editor; stored as cents.
 */
export async function setConnectorSpendCap(input: { capDollars: number }): Promise<SettingsWriteResult> {
  await requireOperator();

  const dollars = Number(input.capDollars);
  if (!Number.isFinite(dollars) || dollars < 0) {
    return { ok: false, error: "Enter a spend cap of $0 or more." };
  }
  const requestedCents = Math.round(dollars * 100);

  // Refuse above the platform ceiling rather than silently clamping. Someone
  // typing a number far too large is usually making a units mistake, and quietly
  // storing a different number than they typed would leave them believing a much
  // higher cap is in force. `setSpendCapCents` clamps too — that's the backstop
  // for non-UI callers; this is the one that tells a human.
  if (requestedCents > MAX_WORKSPACE_SPEND_CAP_CENTS) {
    return {
      ok: false,
      error: `The most a workspace can authorise is ${formatCents(MAX_WORKSPACE_SPEND_CAP_CENTS)} per period. Ask us if you genuinely need more.`,
    };
  }
  const capCents = requestedCents;

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.workspaceId) return { ok: false, error: "No active workspace." };

  try {
    await setSpendCapCents(getSupabaseAdminClient(), {
      workspaceId: ctx.workspaceId,
      orgId: ctx.orgId ?? null,
      capCents,
      updatedBy: ctx.userId ?? null,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update the spend cap." };
  }

  revalidatePath("/settings");
  return { ok: true, persisted: true, message: `Metered-connector spend cap set to $${(capCents / 100).toFixed(0)}.` };
}
