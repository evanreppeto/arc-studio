import { arcGuard, fail, ok } from "@/app/api/v1/arc/_lib/http";
import { isCustomFieldObjectKey, type CustomFieldObjectKey } from "@/domain";
import { getCustomObjectByKey } from "@/lib/custom-objects/definitions";
import { listFieldDefinitions } from "@/lib/custom-fields/definitions";
import { getCustomFieldContextForRecord, saveCustomFieldValues } from "@/lib/custom-fields/values";

/**
 * Arc's read/write access to a workspace's own custom fields (BSR-493).
 *
 *   GET  /api/v1/arc/crm/custom-fields?object=properties
 *        -> the object's field definitions, so Arc knows what this tenant tracks
 *   GET  /api/v1/arc/crm/custom-fields?object=properties&record_id=<uuid>
 *        -> that record's FILLED values, for personalization
 *   POST /api/v1/arc/crm/custom-fields
 *        { object, record_id, values: { <field_key>: <value> } }
 *
 * The write goes through `saveCustomFieldValues` — the same function the
 * operator's record editor calls — so the agent and the human share one
 * validation path rather than drifting apart. Values are internal record data,
 * never outbound, so this needs no approval gate.
 *
 * Reads return only FILLED fields on purpose. Handing Arc a list of empty
 * fields invites it to fill them in with plausible inventions, which is the
 * failure the provenance work exists to prevent.
 */
/**
 * Is `object` a record type this workspace actually has?
 *
 * The six built-ins are tables and always valid. A tenant-defined type is a row
 * in custom_objects, so validity is per-workspace and cannot be answered from a
 * constant — which is what the old `isCustomFieldObjectKey` check did, and why
 * custom objects could hold fields that Arc was then refused permission to
 * read. Their fields ARE their shape, so that refusal made them opaque.
 */
async function resolveObjectKey(orgId: string, object: unknown): Promise<string | null> {
  if (typeof object !== "string" || !object) return null;
  if (isCustomFieldObjectKey(object)) return object;
  const custom = await getCustomObjectByKey(orgId, object).catch(() => null);
  return custom ? custom.key : null;
}

const INVALID_OBJECT =
  "`object` must be one of companies, contacts, properties, leads, jobs, outcomes, or one of this workspace's own record types (GET /api/v1/arc/crm/object-types).";

export async function GET(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  const url = new URL(request.url);
  const object = url.searchParams.get("object");
  const recordId = url.searchParams.get("record_id");

  const objectKey = await resolveObjectKey(allowed.scope.orgId, object);
  if (!objectKey) return fail("invalid_object", INVALID_OBJECT, 400);

  try {
    if (recordId) {
      const fields = await getCustomFieldContextForRecord(
        allowed.scope.orgId,
        objectKey as CustomFieldObjectKey,
        recordId,
      );
      return ok({ object: objectKey, record_id: recordId, fields });
    }

    const definitions = await listFieldDefinitions(allowed.scope.orgId, objectKey as CustomFieldObjectKey);
    return ok({
      object: objectKey,
      definitions: definitions.map((d) => ({
        key: d.key,
        label: d.label,
        type: d.fieldType,
        required: d.required,
        options: d.options,
        help_text: d.helpText,
      })),
    });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to read custom fields.", 502);
  }
}

export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail("invalid_json", "Body must be JSON.", 400);
  }

  const object = typeof body.object === "string" ? body.object : "";
  const recordId = typeof body.record_id === "string" ? body.record_id.trim() : "";
  const values = body.values;

  const objectKey = await resolveObjectKey(allowed.scope.orgId, object);
  if (!objectKey) return fail("invalid_object", INVALID_OBJECT, 400);
  if (!recordId) {
    return fail("invalid_record", "`record_id` is required.", 400);
  }
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return fail("invalid_values", "`values` must be an object keyed by field key.", 400);
  }

  try {
    const result = await saveCustomFieldValues(
      allowed.scope.orgId,
      objectKey as CustomFieldObjectKey,
      recordId,
      values as Record<string, unknown>,
    );

    // A rejected value is the caller's problem to fix, not a server fault —
    // 400 with the field-level message so Arc can correct and retry.
    if (!result.ok) return fail("invalid_value", result.error, 400);

    return ok({ object, record_id: recordId, saved: result.saved });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to save custom fields.", 502);
  }
}
