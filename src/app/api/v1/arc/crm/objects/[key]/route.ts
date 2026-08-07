import { arcGuard, fail, ok, readJson, INVALID_JSON } from "@/app/api/v1/arc/_lib/http";
import { pageMeta, readLimit } from "@/app/api/v1/arc/_lib/paging";
import { getCustomObjectByKey } from "@/lib/custom-objects/definitions";
import { createCustomRecord, listCustomRecords, updateCustomRecord } from "@/lib/custom-objects/records";
import { getPipelineStages } from "@/lib/pipeline-stages/read-model";
import { getCustomFieldsForRecords } from "@/lib/custom-fields/values";
import { findStage, orderedStages, type CustomFieldObjectKey, type CustomObject } from "@/domain";
import type { NextResponse } from "next/server";

/**
 * Records of a tenant-defined record type.
 *
 *   GET  /api/v1/arc/crm/objects/equipment?q=extractor&limit=25
 *   POST /api/v1/arc/crm/objects/equipment   { "title": "...", "subtitle": "..." }
 *
 * Discover the available keys with GET /api/v1/arc/crm/object-types — a key is
 * per-workspace, so there is no fixed list to hardcode against.
 *
 * Custom field VALUES come back inline on each row. They are not decoration
 * here the way they are on a contact: a custom object's shape IS its fields, so
 * a row without them is a bare name and Arc would have to make a second call
 * per record to learn anything worth acting on.
 *
 * Creating a record is internal and never outbound — the same footing as
 * create_lead. Nothing here can reach a customer.
 */

const MAX_TITLE = 200;

// Explicit union: inferred from the returns, TypeScript widens each branch with
// the other's keys as optional-undefined, `"error" in scope` then narrows
// nothing, and `return scope.error` becomes possibly-undefined — a route that
// type-checks as returning no response at all.
type Resolved =
  | { error: NextResponse }
  | { orgId: string; object: CustomObject };

async function resolve(request: Request, key: string): Promise<Resolved> {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return { error: allowed.response } as const;

  const orgId = allowed.scope.orgId;
  const object = await getCustomObjectByKey(orgId, key).catch(() => null);
  if (!object) {
    // Name the discovery route rather than just refusing: a wrong key here is
    // almost always a model that guessed instead of listing.
    return {
      error: fail(
        "not_found",
        `No record type "${key}" in this workspace. List the available ones with GET /api/v1/arc/crm/object-types.`,
        404,
      ),
    };
  }
  return { orgId, object };
}

export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  const scope = await resolve(request, key);
  if ("error" in scope) return scope.error;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = readLimit(url);
  const archived = url.searchParams.get("archived") === "true";
  const status = url.searchParams.get("status")?.trim() || undefined;

  try {
    const [all, stages] = await Promise.all([
      listCustomRecords(scope.orgId, scope.object, { archived, status }),
      getPipelineStages(scope.orgId, scope.object.key).catch(() => []),
    ]);

    // Matching on the title and subtitle, then on field values below. The store
    // holds values in a separate table, so a value-aware filter cannot be a
    // simple column predicate — and for the sizes this serves (a tenant's own
    // equipment list, not their contact book) filtering the page in memory is
    // honest and cheap.
    const matched = q
      ? all.filter((r) => `${r.title} ${r.subtitle ?? ""}`.toLowerCase().includes(q))
      : all;

    const total = matched.length;
    const page = limit === 0 ? [] : matched.slice(0, limit);

    const valuesByRecord = page.length
      ? await getCustomFieldsForRecords(
          scope.orgId,
          scope.object.key as CustomFieldObjectKey,
          page.map((r) => r.id),
        ).catch(() => new Map())
      : new Map();

    const records = page.map((r) => {
      const entries = valuesByRecord.get(r.id) ?? [];
      const fields: Record<string, string> = {};
      for (const e of entries) if (e.display) fields[e.definition.key] = e.display;
      // The stage's LABEL as well as its key: the key is what a write takes,
      // the label is the tenant's own word and the only one worth repeating
      // back to a person. An unknown key (its stage archived) keeps the raw
      // value rather than vanishing.
      const stage = findStage(stages, r.status);
      return {
        id: r.id,
        title: r.title,
        subtitle: r.subtitle,
        status: r.status,
        status_label: stage?.label ?? r.status ?? null,
        fields,
        updated_at: r.updatedAt,
        archived: r.archivedAt !== null,
        href: `/crm/${scope.object.key}/${r.id}`,
      };
    });

    return ok({
      object_type: { key: scope.object.key, label: scope.object.labelPlural, singular: scope.object.labelSingular },
      records,
      ...pageMeta(total, records.length, limit),
    });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to list those records.", 502);
  }
}

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  const scope = await resolve(request, key);
  if ("error" in scope) return scope.error;

  const body = await readJson(request);
  if (body === INVALID_JSON) return fail("invalid_json", "Body must be valid JSON.", 400);

  const payload = (body ?? {}) as { title?: unknown; subtitle?: unknown; status?: unknown };
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (!title) {
    return fail("invalid_payload", `"title" is required — it is what this ${scope.object.labelSingular.toLowerCase()} is called.`, 400);
  }
  if (title.length > MAX_TITLE) {
    return fail("invalid_payload", `"title" must be ${MAX_TITLE} characters or fewer.`, 400);
  }
  const subtitle = typeof payload.subtitle === "string" ? payload.subtitle.trim() : null;

  // An optional starting stage, validated the same way PATCH validates a move:
  // an unknown key stored here would render as its raw value on the operator's
  // board. Silently dropped rather than refused — the record is still worth
  // creating, and the caller is told which stage it landed in.
  let status: string | null = null;
  if (typeof payload.status === "string" && payload.status.trim()) {
    const stages = await getPipelineStages(scope.orgId, scope.object.key).catch(() => []);
    const wanted = payload.status.trim();
    status = stages.some((st) => st.key === wanted) ? wanted : null;
  }

  try {
    // Stamped as the agent's. This is Arc writing, and the board attributes the
    // owner from this column — without it Arc's records read as the operator's.
    const result = await createCustomRecord(
      scope.orgId,
      scope.object,
      { title, subtitle, status },
      { origin: "agent" },
    );
    if (!result.ok) return fail("failed", result.error, 502);
    // `persisted: false` is the honest offline signal, same as the other write
    // routes: the caller is told nothing was saved rather than being handed a
    // success it can't verify.
    return ok(
      {
        persisted: result.persisted,
        record: result.id ? { id: result.id, title, subtitle, status, href: `/crm/${scope.object.key}/${result.id}` } : null,
      },
      result.persisted ? 201 : 202,
    );
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to create that record.", 502);
  }
}

/**
 * Move one record to a stage.
 *
 *   PATCH /api/v1/arc/crm/objects/equipment  { "record_id": "...", "status": "retired" }
 *
 * Internal only — a stage change never reaches a customer. Separate from POST
 * because creating and advancing are different intents, and a PATCH that could
 * silently create would make "move this to retired" able to invent a record.
 */
export async function PATCH(request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  const scope = await resolve(request, key);
  if ("error" in scope) return scope.error;

  const body = await readJson(request);
  if (body === INVALID_JSON) return fail("invalid_json", "Body must be valid JSON.", 400);

  const payload = (body ?? {}) as { record_id?: unknown; status?: unknown };
  const recordId = typeof payload.record_id === "string" ? payload.record_id.trim() : "";
  if (!recordId) return fail("invalid_payload", "`record_id` is required.", 400);
  if (typeof payload.status !== "string") {
    return fail("invalid_payload", "`status` is required — the stage key to move this record to.", 400);
  }
  const status = payload.status.trim();

  const stages = orderedStages(await getPipelineStages(scope.orgId, scope.object.key).catch(() => []));
  if (stages.length === 0) {
    return fail(
      "no_pipeline",
      `"${scope.object.labelPlural}" has no stages, so there is nowhere to move this. An operator defines them in Settings.`,
      409,
    );
  }
  // Validated against the org's OWN stages: an unknown key would store and then
  // render as its raw value, which looks like data corruption to the operator.
  if (!stages.some((st) => st.key === status)) {
    return fail(
      "invalid_status",
      `"${status}" is not a stage on ${scope.object.labelPlural}. Available: ${stages.map((st) => st.key).join(", ")}.`,
      400,
    );
  }

  try {
    const result = await updateCustomRecord(scope.orgId, scope.object, recordId, { status });
    if (!result.ok) return fail("failed", result.error, 502);
    const stage = stages.find((st) => st.key === status);
    return ok({
      persisted: result.persisted,
      record_id: recordId,
      status,
      status_label: stage?.label ?? status,
    });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to move that record.", 502);
  }
}
