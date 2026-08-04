import { arcGuard, fail, ok } from "@/app/api/v1/arc/_lib/http";
import { getVaultNote, getVaultNotes } from "@/lib/vault/read-model";

/**
 * Arc's vault knowledge. List all notes, or one note via ?slug=. Scoped to the
 * token's workspace org via arcGuard so a per-workspace runner token reads its
 * OWN vault, not the cookie/default org.
 *   GET /api/v1/arc/vault            ->  { ok, notes }
 *   GET /api/v1/arc/vault?slug=foo   ->  { ok, note } | 404
 */
export async function GET(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;
  const slug = new URL(request.url).searchParams.get("slug");
  try {
    if (slug) {
      const note = await getVaultNote(slug, allowed.scope.orgId, allowed.scope.workspaceId);
      if (!note) return fail("not_found", `No vault note for slug "${slug}".`, 404);
      return ok({ note });
    }
    const model = await getVaultNotes(allowed.scope.orgId, allowed.scope.workspaceId);
    return ok({ notes: model.notes });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to read the vault.", 502);
  }
}
