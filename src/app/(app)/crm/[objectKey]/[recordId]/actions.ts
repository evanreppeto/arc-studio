"use server";

import { revalidatePath } from "next/cache";

import { entityTypeFromCrmObjectKey, isAllowedPersona, parseNoteInput, parseTaskInput, type CustomFieldObjectKey } from "@/domain";
import { saveCustomFieldValues } from "@/lib/custom-fields/values";
import { getOperatorActor, requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { updateCrmRecordFields } from "@/lib/crm/create";
import { getOrgPersonaKeys } from "@/lib/personas/read-model";
import { type CrmObjectKey } from "@/lib/crm/read-model";
import { insertNote, insertTask, setNotePinned, updateTaskStatus } from "@/lib/interactions/persistence";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Real operator writes for the CRM record Activity tab. Notes and follow-up tasks
 * are internal (never outbound), so they persist directly — but they still go
 * through requireOperator() + the org-scoped persistence layer, and log a
 * companion timeline activity. `persisted: false` is the honest offline/demo
 * signal: the caller may show the item optimistically without claiming it saved.
 */
export type WriteResult = { ok: true; persisted: boolean; id?: string } | { ok: false; error: string };

const VALID_KEYS = new Set(["companies", "contacts", "properties", "leads", "jobs", "outcomes"]);

async function currentScope() {
  const ctx = await getCurrentWorkspaceContext();
  return { orgId: ctx.orgId, workspaceId: ctx.workspaceId ?? undefined };
}

/** Edit a CRM record's persona and/or status (internal; never outbound). */
export async function updateCrmRecord(
  objectKey: string,
  recordId: string,
  patch: { persona?: string; status?: string },
): Promise<WriteResult> {
  await requireOperator();
  if (!VALID_KEYS.has(objectKey)) return { ok: false, error: "Unknown record type." };
  if (!patch.persona && !patch.status) return { ok: false, error: "Nothing to change." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const scope = await currentScope();
  if (patch.persona && !isAllowedPersona(patch.persona, await getOrgPersonaKeys(scope.orgId))) {
    return { ok: false, error: "Choose a valid persona." };
  }

  const result = await updateCrmRecordFields(objectKey as CrmObjectKey, recordId, patch, scope.orgId);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/crm/${objectKey}/${recordId}`);
  return { ok: true, persisted: true, id: result.id };
}

export async function addRecordNote(objectKey: string, recordId: string, body: string): Promise<WriteResult> {
  await requireOperator();
  if (!VALID_KEYS.has(objectKey)) return { ok: false, error: "Unknown record type." };
  const entityType = entityTypeFromCrmObjectKey(objectKey);
  if (!entityType) return { ok: false, error: "Unknown record type." };

  const actor = await getOperatorActor();
  const parsed = parseNoteInput({ entityType, entityId: recordId, body, authorKind: "human", authorName: actor, isInternal: true });
  if (!parsed.ok) return { ok: false, error: parsed.error };

  // Offline/demo: no DB to write to. Report success-but-unpersisted so the UI can
  // show it without claiming it was saved.
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const result = await insertNote(parsed.value, await currentScope());
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/crm/${objectKey}/${recordId}`);
  return { ok: true, persisted: true, id: result.id };
}

export async function addRecordTask(
  objectKey: string,
  recordId: string,
  title: string,
  priority?: string,
): Promise<WriteResult> {
  await requireOperator();
  if (!VALID_KEYS.has(objectKey)) return { ok: false, error: "Unknown record type." };
  const entityType = entityTypeFromCrmObjectKey(objectKey);
  if (!entityType) return { ok: false, error: "Unknown record type." };

  const actor = await getOperatorActor();
  const parsed = parseTaskInput({
    entityType,
    entityId: recordId,
    title,
    priority,
    authorKind: "human",
    authorName: actor,
    assigneeKind: "human",
    assigneeName: actor,
  });
  if (!parsed.ok) return { ok: false, error: parsed.error };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const result = await insertTask(parsed.value, await currentScope());
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/crm/${objectKey}/${recordId}`);
  return { ok: true, persisted: true, id: result.id };
}

export async function completeRecordTask(objectKey: string, recordId: string, taskId: string): Promise<WriteResult> {
  await requireOperator();
  if (!VALID_KEYS.has(objectKey)) return { ok: false, error: "Unknown record type." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const actor = await getOperatorActor();
  const result = await updateTaskStatus(taskId, "completed", { kind: "human", name: actor }, await currentScope());
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/crm/${objectKey}/${recordId}`);
  return { ok: true, persisted: true };
}

/** Reopen a completed task (status -> open; the persistence clears completed_at).
 *  The undo half of completeRecordTask so a mis-completed task isn't stuck done.
 *  Internal; never outbound. Org-scoped in updateTaskStatus. */
export async function reopenRecordTask(objectKey: string, recordId: string, taskId: string): Promise<WriteResult> {
  await requireOperator();
  if (!VALID_KEYS.has(objectKey)) return { ok: false, error: "Unknown record type." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const actor = await getOperatorActor();
  const result = await updateTaskStatus(taskId, "open", { kind: "human", name: actor }, await currentScope());
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/crm/${objectKey}/${recordId}`);
  return { ok: true, persisted: true };
}

/** Pin or unpin a record note (internal; never outbound). The notes list already
 *  renders a pinned indicator — this is the missing write half. Org-scoped. */
export async function setRecordNotePinned(
  objectKey: string,
  recordId: string,
  noteId: string,
  isPinned: boolean,
): Promise<WriteResult> {
  await requireOperator();
  if (!VALID_KEYS.has(objectKey)) return { ok: false, error: "Unknown record type." };
  if (!noteId) return { ok: false, error: "Missing note." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const result = await setNotePinned(noteId, isPinned, await currentScope());
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/crm/${objectKey}/${recordId}`);
  return { ok: true, persisted: true };
}

/**
 * Save this record's custom field values (BSR-493).
 *
 * Internal like notes and tasks — nothing here reaches the outside world — but
 * still requireOperator()-gated and org-scoped from the session, never from the
 * request. Validation lives in the domain layer and is all-or-nothing, so a bad
 * value leaves the record untouched rather than half-updated.
 */
export async function saveRecordCustomFields(input: {
  objectKey: string;
  recordId: string;
  values: Record<string, unknown>;
}): Promise<WriteResult> {
  await requireOperator();
  if (!VALID_KEYS.has(input.objectKey)) return { ok: false, error: "Unknown record type." };
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const { orgId } = await currentScope();
  const result = await saveCustomFieldValues(
    orgId,
    input.objectKey as CustomFieldObjectKey,
    input.recordId,
    input.values,
  );

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/crm/${input.objectKey}/${input.recordId}`);
  return { ok: true, persisted: true };
}
