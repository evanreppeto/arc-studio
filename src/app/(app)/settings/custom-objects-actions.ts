"use server";

import { revalidatePath } from "next/cache";

import { requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";
import {
  createCustomObject,
  setCustomObjectActive,
  updateCustomObject,
} from "@/lib/custom-objects/definitions";

import type { SettingsWriteResult } from "./actions";

/**
 * An object type is the tenant's own schema — creating one adds a tab to the
 * CRM and a route. Same gate as the other structural settings writes:
 * requireOperator() plus an org resolved from the session, never the request.
 */
async function operatorOrg(): Promise<{ orgId: string } | { error: string }> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) {
    return { error: "Record types need a configured database." };
  }
  const ctx = await getCurrentWorkspaceContext().catch(() => null);
  if (!ctx?.orgId) return { error: "Could not resolve your workspace." };
  return { orgId: ctx.orgId };
}

/** Every surface that lists object types or routes to one. */
function revalidateObjectSurfaces(): void {
  revalidatePath("/settings");
  revalidatePath("/crm");
}

export async function createObjectType(input: {
  labelPlural: string;
  labelSingular: string;
  description?: string;
}): Promise<SettingsWriteResult> {
  const scope = await operatorOrg();
  if ("error" in scope) return { ok: false, error: scope.error };

  const result = await createCustomObject(scope.orgId, input);
  if (!result.ok) return { ok: false, error: result.error };

  revalidateObjectSurfaces();
  return { ok: true, persisted: true, message: `“${result.object.labelPlural}” added. It's a tab in your CRM now.` };
}

export async function renameObjectType(input: {
  objectId: string;
  labelPlural: string;
  labelSingular: string;
  description?: string | null;
}): Promise<SettingsWriteResult> {
  const scope = await operatorOrg();
  if ("error" in scope) return { ok: false, error: scope.error };

  const result = await updateCustomObject(scope.orgId, input.objectId, {
    labelPlural: input.labelPlural,
    labelSingular: input.labelSingular,
    description: input.description,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidateObjectSurfaces();
  return { ok: true, persisted: true, message: "Renamed." };
}

/**
 * Archive, never delete. The schema refuses to drop a type that has records
 * (`on delete restrict`), because dropping it would orphan every row — so
 * archiving is the only removal there is, and it keeps everything.
 */
export async function archiveObjectType(input: { objectId: string }): Promise<SettingsWriteResult> {
  const scope = await operatorOrg();
  if ("error" in scope) return { ok: false, error: scope.error };

  const result = await setCustomObjectActive(scope.orgId, input.objectId, false);
  if (!result.ok) return { ok: false, error: result.error };

  revalidateObjectSurfaces();
  return { ok: true, persisted: true, message: "Archived. Its records are kept — restore it any time." };
}

export async function restoreObjectType(input: { objectId: string }): Promise<SettingsWriteResult> {
  const scope = await operatorOrg();
  if ("error" in scope) return { ok: false, error: scope.error };

  const result = await setCustomObjectActive(scope.orgId, input.objectId, true);
  if (!result.ok) return { ok: false, error: result.error };

  revalidateObjectSurfaces();
  return { ok: true, persisted: true, message: "Restored." };
}
