import { arcGuard, fail, ok } from "@/app/api/v1/arc/_lib/http";
import { listFieldDefinitions } from "@/lib/custom-fields/definitions";
import { listCustomObjects } from "@/lib/custom-objects/definitions";
import { countCustomRecords } from "@/lib/custom-objects/records";
import type { CustomFieldObjectKey } from "@/domain";

/**
 * The workspace's OWN record types — discovery for everything else Arc can do
 * with them.
 *
 *   GET /api/v1/arc/crm/object-types
 *
 * The six built-ins are tables Arc has dedicated tools for. These are rows: a
 * tenant can define "Equipment", "Subcontractors", "Permits", and Arc has no
 * way to know they exist without asking. Nothing downstream is usable until it
 * has: `key` is what /crm/objects/{key} takes, and the field definitions ARE
 * the record's shape — a custom object carries a name and whatever its owner
 * defined, so listing records without knowing the fields tells Arc almost
 * nothing about them.
 *
 * Returned in one call for that reason. Two round trips to answer "what can I
 * even look at here" is how a discovery step gets skipped.
 *
 * Read-only. Archived types are omitted: they are out of the operator's CRM, so
 * Arc reasoning about them would be reasoning about records nobody can see.
 */
export async function GET(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  const orgId = allowed.scope.orgId;

  try {
    const objects = await listCustomObjects(orgId);

    const types = await Promise.all(
      objects.map(async (object) => {
        // Fields and count per type. Both are small reads and both are what the
        // model needs before it can ask a useful second question.
        const [fields, count] = await Promise.all([
          listFieldDefinitions(orgId, object.key as CustomFieldObjectKey).catch(() => []),
          countCustomRecords(orgId, object).catch(() => 0),
        ]);
        return {
          key: object.key,
          label: object.labelPlural,
          singular: object.labelSingular,
          description: object.description,
          record_count: count,
          fields: fields.map((f) => ({
            key: f.key,
            label: f.label,
            type: f.fieldType,
            required: f.required,
            choices: f.options.length > 0 ? f.options.map((o) => o.label) : undefined,
          })),
        };
      }),
    );

    return ok({ object_types: types, total: types.length });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to list record types.", 502);
  }
}
