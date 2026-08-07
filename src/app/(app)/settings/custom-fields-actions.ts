"use server";

import { revalidatePath } from "next/cache";

import { requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";
import {
  archiveFieldDefinition,
  createFieldDefinition,
  restoreFieldDefinition,
  updateFieldDefinition,
} from "@/lib/custom-fields/definitions";

import type { SettingsWriteResult } from "./actions";

/**
 * Custom field definitions are a tenant's own schema: every CRM record page and
 * every Arc read of that object changes shape when one changes. So these are
 * requireOperator()-gated like the other structural settings writes, and every
 * one of them is org-scoped from the session rather than from the request.
 */
async function operatorOrg(): Promise<{ orgId: string } | { error: string }> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) {
    return { error: "Custom fields need a configured database." };
  }
  const ctx = await getCurrentWorkspaceContext().catch(() => null);
  if (!ctx?.orgId) {
    // Refuse rather than guess a tenant — writing one workspace's schema into
    // another is exactly the failure the org-scoping work closed.
    return { error: "Could not resolve your workspace." };
  }
  return { orgId: ctx.orgId };
}

// Takes a plain string: a tenant-defined type's key is per-org, and gating
// revalidation on the six left custom objects showing a stale field list after
// every edit.
function revalidateFieldSurfaces(objectKey: string): void {
  revalidatePath("/settings");
  revalidatePath("/crm");
  revalidatePath(`/crm/${objectKey}`);
}

export async function createCustomField(input: {
  objectKey: string;
  label: string;
  fieldType: string;
  required?: boolean;
  options?: string[];
  helpText?: string;
}): Promise<SettingsWriteResult> {
  const scope = await operatorOrg();
  if ("error" in scope) return { ok: false, error: scope.error };

  // No key check here. `createFieldDefinition` resolves it against the org's
  // own record types — a constant can't answer that, and this refusing on the
  // six was why a tenant-defined type could never hold a single field.
  const result = await createFieldDefinition(scope.orgId, {
    objectKey: input.objectKey,
    label: input.label,
    fieldType: input.fieldType,
    required: input.required === true,
    options: input.options,
    helpText: input.helpText,
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidateFieldSurfaces(input.objectKey);
  return { ok: true, persisted: true, message: `Added "${result.definition.label}".` };
}

export async function updateCustomField(input: {
  fieldId: string;
  objectKey: string;
  label?: string;
  required?: boolean;
  options?: string[];
  helpText?: string;
  sortOrder?: number;
}): Promise<SettingsWriteResult> {
  const scope = await operatorOrg();
  if ("error" in scope) return { ok: false, error: scope.error };

  // fieldType is deliberately not editable from here — changing it reinterprets
  // stored values, and the lib layer refuses it once the field has data.
  const result = await updateFieldDefinition(scope.orgId, input.fieldId, {
    label: input.label,
    required: input.required,
    options: input.options,
    helpText: input.helpText,
    sortOrder: input.sortOrder,
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidateFieldSurfaces(input.objectKey);
  return { ok: true, persisted: true, message: "Field updated." };
}

/**
 * Archive, never hard-delete. Values are retained, so this is reversible and
 * safe to offer as the only removal affordance on a tenant's own schema.
 */
export async function archiveCustomField(input: {
  fieldId: string;
  objectKey: string;
}): Promise<SettingsWriteResult> {
  const scope = await operatorOrg();
  if ("error" in scope) return { ok: false, error: scope.error };

  const result = await archiveFieldDefinition(scope.orgId, input.fieldId);
  if (!result.ok) return { ok: false, error: result.error };

  revalidateFieldSurfaces(input.objectKey);
  return { ok: true, persisted: true, message: "Field archived. Its saved values are kept." };
}

export async function restoreCustomField(input: {
  fieldId: string;
  objectKey: string;
}): Promise<SettingsWriteResult> {
  const scope = await operatorOrg();
  if ("error" in scope) return { ok: false, error: scope.error };

  const result = await restoreFieldDefinition(scope.orgId, input.fieldId);
  if (!result.ok) return { ok: false, error: result.error };

  revalidateFieldSurfaces(input.objectKey);
  return { ok: true, persisted: true, message: "Field restored." };
}
