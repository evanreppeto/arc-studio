import { type SupabaseClient } from "@supabase/supabase-js";

import { type AudienceResolution, type Contact, ContactSchema, resolveCampaignAudience } from "@/domain";

import { loadSuppressedAddresses } from "@/lib/email-suppression/persistence";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

const CANDIDATE_CAP = 10_000;

// One row per campaign holds the operator-picked ("manual") contacts, kept in
// inclusion_rules.manual_contact_ids. Reused (campaign_audiences has no dedicated
// membership table) so bulk "Add to campaign" is migration-free.
const MANUAL_AUDIENCE_NAME = "Manual (added from CRM)";

type ManualInclusion = { manual_contact_ids?: unknown } | null;

/** The operator-picked contact ids attached to a campaign, or []. */
async function readManualContactIds(client: SupabaseClient, campaignId: string): Promise<string[]> {
  const { data } = await client
    .from("campaign_audiences")
    .select("inclusion_rules")
    .eq("campaign_id", campaignId)
    .eq("audience_name", MANUAL_AUDIENCE_NAME)
    .maybeSingle<{ inclusion_rules: ManualInclusion }>();
  const ids = data?.inclusion_rules?.manual_contact_ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
}

/**
 * Attach operator-picked contacts to a campaign's manual audience (the CRM board's
 * bulk "Add to campaign"). Merges into the single manual row for the campaign,
 * de-duping. The caller MUST have verified the campaign belongs to the operator's
 * org — campaign_audiences has no org_id of its own; it inherits scope through the
 * org-checked campaign_id. Returns the new total.
 */
export async function addContactsToCampaignAudience(
  client: SupabaseClient,
  campaignId: string,
  persona: string,
  contactIds: string[],
): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
  const clean = [...new Set(contactIds.map((id) => id.trim()).filter((id) => id && !id.startsWith("local-")))];
  if (clean.length === 0) return { ok: true, total: 0 };

  const existing = await readManualContactIds(client, campaignId);
  const merged = [...new Set([...existing, ...clean])];
  const now = new Date().toISOString();

  const { data: row } = await client
    .from("campaign_audiences")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("audience_name", MANUAL_AUDIENCE_NAME)
    .maybeSingle<{ id: string }>();

  const fields = {
    persona,
    audience_name: MANUAL_AUDIENCE_NAME,
    inclusion_rules: { manual_contact_ids: merged },
    exclusion_rules: {},
    estimated_size: merged.length,
    reasoning_payload: { source: "crm_bulk_add", updated_at: now },
    updated_at: now,
  };

  const { error } = row
    ? await client.from("campaign_audiences").update(fields as never).eq("id", row.id)
    : await client
        .from("campaign_audiences")
        .insert({ id: crypto.randomUUID(), campaign_id: campaignId, created_at: now, ...fields } as never);
  if (error) return { ok: false, error: error.message };
  return { ok: true, total: merged.length };
}

/**
 * Read-only email-audience preview for a campaign: fetch the campaign's targeting
 * + candidate contacts (persona set / 1:1 target UNION any manually-added
 * contacts), then run the pure domain resolver. NO dispatch rows, NO send. Returns
 * null when the campaign/backend can't be read. All the resolution rules
 * (suppression via contact_status, address validity, de-dup, reason tags) live in
 * src/domain/audience-resolution.ts — this only does the I/O.
 */
export async function getCampaignAudiencePreview(
  input: { campaignId: string; orgId: string },
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<AudienceResolution | null> {
  const { campaignId, orgId } = input;
  try {
    const { data: campaign, error: campaignError } = await client
      .from("campaigns")
      .select("persona,company_id,contact_id")
      .eq("id", campaignId)
      .eq("org_id", orgId)
      .maybeSingle<{ persona: string; company_id: string | null; contact_id: string | null }>();
    if (campaignError || !campaign?.persona) return null;

    const manualContactIds = await readManualContactIds(client, campaignId);

    // Candidate set: the 1:1 target contact, else the persona's contacts, UNION the
    // manually-added contacts (they qualify regardless of persona — see isCandidate).
    let query = client.from("contacts").select("*").eq("org_id", orgId);
    query = campaign.contact_id ? query.eq("id", campaign.contact_id) : query.eq("persona", campaign.persona);
    const { data: personaRows, error } = await query.limit(CANDIDATE_CAP);
    if (error) return null;

    let manualRows: unknown[] = [];
    if (manualContactIds.length > 0) {
      const { data } = await client.from("contacts").select("*").eq("org_id", orgId).in("id", manualContactIds).limit(CANDIDATE_CAP);
      manualRows = data ?? [];
    }

    const byId = new Map<string, unknown>();
    for (const rawRow of [...(personaRows ?? []), ...manualRows]) {
      const id = (rawRow as { id?: string }).id;
      if (id) byId.set(id, rawRow);
    }
    const contacts: Contact[] = [];
    for (const rawRow of byId.values()) {
      const parsed = ContactSchema.safeParse(rawRow);
      if (parsed.success) contacts.push(parsed.data);
    }

    // The preview must agree with what a send would actually do. Before BSR-482
    // it did not: unsubscribed contacts appeared here as reachable recipients,
    // and an operator sizing an audience was reading a number the send gate
    // would then quietly reduce.
    const suppressedAddresses = await loadSuppressedAddresses(orgId, client);

    return resolveCampaignAudience(
      { persona: campaign.persona, contactId: campaign.contact_id, companyId: campaign.company_id, manualContactIds },
      contacts,
      "email",
      { suppressedAddresses },
    );
  } catch {
    return null;
  }
}
