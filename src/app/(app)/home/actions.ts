"use server";

import { revalidatePath } from "next/cache";

import { requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { dismissActivation } from "@/lib/activation/persistence";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Dismiss the first-run setup checklist for this workspace.
 *
 * Sticky on purpose: an owner who has decided the panel is noise should not see
 * it again on the next visit just because a step is still unfinished. The
 * checklist is guidance, not a gate.
 */
export async function dismissSetupChecklistAction(): Promise<{ ok: boolean }> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: true };

  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.orgId) return { ok: false };

  try {
    await dismissActivation(ctx.orgId);
  } catch {
    return { ok: false };
  }

  revalidatePath("/home");
  return { ok: true };
}
