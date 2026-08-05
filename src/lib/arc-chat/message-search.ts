import "server-only";

import { type SupabaseClient } from "@supabase/supabase-js";

import { buildArcMessageSnippet, escapeLikePattern, type ArcMessageSnippet } from "@/domain";

import { getSupabaseAdminClient } from "../supabase/server";

/** One message that matched, with enough context to render and open it. */
export type ArcMessageSearchHit = {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  role: "operator" | "arc" | "system";
  snippet: ArcMessageSnippet;
  createdAt: string;
};

/**
 * Search message bodies across the conversations a viewer may already see.
 *
 * Access is bounded by `conversationIds` — the caller passes the ids from
 * `listConversationsForViewer`, so this reuses the proven access path instead
 * of inventing a second one. An empty list returns nothing rather than
 * searching everything, which is the failure mode that would matter.
 *
 * `ilike` rather than full-text on purpose: substring matching is what an
 * operator expects from a search box ("pricing" should find "pricing-intent"),
 * and tsquery stemming would miss exactly that. If message volume ever makes
 * this slow, the fix is a trigram index on `arc_messages.body`, not a switch to
 * tsvector.
 */
export async function searchArcMessages(
  conversationIds: string[],
  query: string,
  options: { limit?: number } = {},
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcMessageSearchHit[]> {
  const needle = query.trim();
  if (conversationIds.length === 0 || !needle) return [];

  const { data, error } = await client
    .from("arc_messages")
    .select("id, conversation_id, role, body, created_at")
    .in("conversation_id", conversationIds)
    // Escaped so a `%` or `_` in the query stays a literal — otherwise
    // searching "50%" silently matches the entire workspace.
    .ilike("body", `%${escapeLikePattern(needle)}%`)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 30);
  if (error) throw new Error(`arc_messages search failed: ${error.message}`);

  const rows = (data ?? []) as {
    id: string;
    conversation_id: string;
    role: "operator" | "arc" | "system";
    body: string;
    created_at: string;
  }[];

  return rows.flatMap((row) => {
    // The snippet builder flattens markdown before matching, so a hit that only
    // existed in syntax the reader never sees (a code fence, a link target)
    // yields no snippet — and is dropped rather than shown without a reason.
    const snippet = buildArcMessageSnippet(row.body, needle);
    if (!snippet) return [];
    return [{
      messageId: row.id,
      conversationId: row.conversation_id,
      conversationTitle: "",
      role: row.role,
      snippet,
      createdAt: row.created_at,
    }];
  });
}
