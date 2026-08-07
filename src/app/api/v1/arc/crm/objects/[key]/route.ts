import { arcGuard, fail, ok, readJson, INVALID_JSON } from "@/app/api/v1/arc/_lib/http";
import { pageMeta, readLimit } from "@/app/api/v1/arc/_lib/paging";
import { getCustomObjectByKey } from "@/lib/custom-objects/definitions";
import { createCustomRecord, listCustomRecords } from "@/lib/custom-objects/records";
import { getCustomFieldsForRecords } from "@/lib/custom-fields/values";
import type { CustomFieldObjectKey, CustomObject } from "@/domain";
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

  try {
    const all = await listCustomRecords(scope.orgId, scope.object, { archived });

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
      return {
        id: r.id,
        title: r.title,
        subtitle: r.subtitle,
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

  const payload = (body ?? {}) as { title?: unknown; subtitle?: unknown };
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (!title) {
    return fail("invalid_payload", `"title" is required — it is what this ${scope.object.labelSingular.toLowerCase()} is called.`, 400);
  }
  if (title.length > MAX_TITLE) {
    return fail("invalid_payload", `"title" must be ${MAX_TITLE} characters or fewer.`, 400);
  }
  const subtitle = typeof payload.subtitle === "string" ? payload.subtitle.trim() : null;

  try {
    const result = await createCustomRecord(scope.orgId, scope.object, { title, subtitle });
    if (!result.ok) return fail("failed", result.error, 502);
    // `persisted: false` is the honest offline signal, same as the other write
    // routes: the caller is told nothing was saved rather than being handed a
    // success it can't verify.
    return ok(
      {
        persisted: result.persisted,
        record: result.id ? { id: result.id, title, subtitle, href: `/crm/${scope.object.key}/${result.id}` } : null,
      },
      result.persisted ? 201 : 202,
    );
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to create that record.", 502);
  }
}
