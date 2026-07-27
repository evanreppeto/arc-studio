import { type ArcMention, type MentionType } from "@/domain";
import { OFFICIAL_PERSONA_MAPPINGS, personaInspectHref } from "@/domain";
import { listCampaignNames } from "@/lib/campaigns/read-model";
import { getCrmMentionSamples, type CrmObjectKey } from "@/lib/crm/read-model";
import { listPersonas } from "@/lib/personas/console";
import { getCurrentOrgId } from "@/lib/auth/org";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { listVaultNotes } from "@/lib/vault/persistence";

export type MentionGroup = {
  type: MentionType;
  label: string;
  items: ArcMention[];
};

const CRM_GROUPS: Array<{ key: CrmObjectKey; type: MentionType; label: string }> = [
  { key: "leads", type: "lead", label: "Leads" },
  { key: "companies", type: "company", label: "Companies" },
  { key: "contacts", type: "contact", label: "Contacts" },
  { key: "properties", type: "property", label: "Properties" },
  { key: "jobs", type: "job", label: "Jobs" },
  { key: "outcomes", type: "outcome", label: "Outcomes" },
];

function personaLabel(key: string): string {
  return key
    .replace(/^persona_/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Build the full @-mention catalog. Read-only, defensive: any group that fails
 * to load resolves to empty rather than breaking the page. Personas are always
 * available (static); the rest require Supabase.
 */
export async function getMentionables(): Promise<MentionGroup[]> {
  // Offline/demo fallback only. Personas are per-org (the `personas` table is the
  // authority), so mentioning one of these static keys in a workspace that
  // doesn't use them would deep-link to a persona it doesn't have.
  const fallbackPersonas: MentionGroup = {
    type: "persona",
    label: "Personas",
    items: OFFICIAL_PERSONA_MAPPINGS.map((key) => ({
      type: "persona" as const,
      id: key,
      label: personaLabel(key),
      href: personaInspectHref(key),
    })),
  };

  if (!isSupabaseAdminConfigured()) {
    return [fallbackPersonas];
  }

  const client = getSupabaseAdminClient();
  // Scope reads to the active workspace. getCrmMentionSamples self-scopes; the
  // campaign list needs the org id passed in (the admin client bypasses RLS).
  const orgId = await getCurrentOrgId().catch(() => undefined);

  // Campaign names, CRM samples, and vault notes are independent — fetch them
  // concurrently. getCrmMentionSamples does a single table-bundle fetch instead
  // of one per CRM object. Each source self-recovers to empty so one slow/failing
  // read doesn't sink the rest.
  const [campaignRefs, crmSamples, vaultNotes, orgPersonas] = await Promise.all([
    listCampaignNames(orgId).catch(() => []),
    getCrmMentionSamples().catch(() => ({}) as Awaited<ReturnType<typeof getCrmMentionSamples>>),
    orgId ? listVaultNotes(client, orgId).catch(() => []) : Promise.resolve([]),
    listPersonas().catch(() => []),
  ]);

  const personas: MentionGroup = orgPersonas.length
    ? {
        type: "persona",
        label: "Personas",
        items: orgPersonas.map((persona) => ({
          type: "persona" as const,
          id: persona.slug,
          label: persona.name,
          href: personaInspectHref(persona.slug),
        })),
      }
    : fallbackPersonas;

  const campaigns: MentionGroup = {
    type: "campaign",
    label: "Campaigns",
    items: campaignRefs.map((c) => ({ type: "campaign" as const, id: c.id, label: c.name, href: c.href })),
  };

  const crmGroups: MentionGroup[] = CRM_GROUPS.map((group) => ({
    type: group.type,
    label: group.label,
    items: (crmSamples[group.key] ?? []).map((row) => ({
      type: group.type,
      id: row.id,
      label: row.name,
      href: `/crm/${group.key}/${row.id}`,
    })),
  }));

  // Deliberately un-linked: there is no `/vault` route in this app (the vault is
  // Arc-API-only), so `/vault/<slug>` rendered a 404 in the chat's Sources row.
  // An empty href keeps the mention valid (ArcMention.href is required, and
  // isArcMention would drop the mention entirely without it) while the Sources
  // row renders it as a static chip instead of a broken link.
  const vault: MentionGroup = {
    type: "vault",
    label: "Vault notes",
    items: vaultNotes.map((note) => ({
      type: "vault" as const,
      id: note.slug,
      label: note.title,
      href: "",
    })),
  };

  return [campaigns, ...crmGroups, personas, vault].filter((g) => g.items.length > 0);
}
