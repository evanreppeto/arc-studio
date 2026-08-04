import { type ArcMention, type MentionType } from "@/domain";
import { OFFICIAL_PERSONA_MAPPINGS, humanizePersonaLabel, personaInspectHref } from "@/domain";
import { getBusinessProfile } from "@/lib/brand-kit/persistence";
import { listCampaignNames } from "@/lib/campaigns/read-model";
import { getCrmMentionSamples, type CrmObjectKey } from "@/lib/crm/read-model";
import { listPersonas } from "@/lib/personas/console";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { getProductLanguage } from "@/lib/product-language";
import { getAppSettings } from "@/lib/settings/store";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { listVaultNotes } from "@/lib/vault/persistence";

export type MentionGroup = {
  type: MentionType;
  label: string;
  items: ArcMention[];
};

// Group LABELS are per-workspace vocabulary, so they live in product-language,
// not here — a home-services workspace calls `properties` "Service locations"
// and a professional-services one calls `jobs` "Engagements". Only the
// key→mention-type wiring is fixed.
const CRM_GROUPS: Array<{ key: CrmObjectKey; type: MentionType }> = [
  { key: "leads", type: "lead" },
  { key: "companies", type: "company" },
  { key: "contacts", type: "contact" },
  { key: "properties", type: "property" },
  { key: "jobs", type: "job" },
  { key: "outcomes", type: "outcome" },
];

/**
 * BSR's 12 personas, offered as @-mentions ONLY in demo mode.
 *
 * Personas are per-org (the org's `personas` rows are the authority), so these
 * keys are meaningless in a real workspace: mentioning one deep-links to a
 * persona the workspace does not have, and hands Arc a persona key it cannot
 * map to anything. An empty list is the correct answer for a workspace with no
 * personas — this fails closed, matching `getOrgPersonaKeys`
 * (`src/lib/personas/read-model.ts`), which made the same choice for validation.
 */
function demoPersonaGroup(): MentionGroup[] {
  if (!isDemoDataEnabled()) return [];
  return [
    {
      type: "persona",
      label: "Personas",
      items: OFFICIAL_PERSONA_MAPPINGS.map((key) => ({
        type: "persona" as const,
        id: key,
        label: humanizePersonaLabel(key),
        href: personaInspectHref(key),
      })),
    },
  ];
}

/**
 * Build the full @-mention catalog. Read-only, defensive: any group that fails
 * to load resolves to empty rather than breaking the page. Every group requires
 * Supabase — including personas, which are per-org data.
 */
export async function getMentionables(): Promise<MentionGroup[]> {
  if (!isSupabaseAdminConfigured()) {
    return demoPersonaGroup();
  }

  const client = getSupabaseAdminClient();
  // Scope reads to the active workspace. getCrmMentionSamples self-scopes; the
  // campaign list needs the org id passed in (the admin client bypasses RLS).
  const tenant = await getCurrentWorkspaceContext().catch(() => null);
  const orgId = tenant?.orgId;
  const workspaceId = tenant?.workspaceId;

  // Campaign names, CRM samples, and vault notes are independent — fetch them
  // concurrently. getCrmMentionSamples does a single table-bundle fetch instead
  // of one per CRM object. Each source self-recovers to empty so one slow/failing
  // read doesn't sink the rest.
  const [campaignRefs, crmSamples, vaultNotes, orgPersonas, appSettings, businessProfile] = await Promise.all([
    listCampaignNames(orgId, undefined, workspaceId).catch(() => []),
    getCrmMentionSamples().catch(() => ({}) as Awaited<ReturnType<typeof getCrmMentionSamples>>),
    orgId ? listVaultNotes(client, orgId).catch(() => []) : Promise.resolve([]),
    listPersonas().catch(() => []),
    orgId ? getAppSettings(orgId).catch(() => null) : Promise.resolve(null),
    orgId ? getBusinessProfile(orgId).catch(() => null) : Promise.resolve(null),
  ]);

  // Same industry resolution the CRM pages use, so a mention group is named what
  // the screen it links to is named. Falls back to `general`'s neutral nouns
  // (Organizations / People / Sites …) when no industry is set — never to the
  // restoration set that used to be hardcoded here.
  const language = getProductLanguage(appSettings?.industry || businessProfile?.industry);

  // The org's own personas, or nothing. This used to fall back to the BSR 12
  // whenever `listPersonas()` came back empty — but with Supabase configured that
  // branch is a LIVE workspace, not the offline preview, so it injected
  // restoration personas into real tenants (and into any workspace whose persona
  // read merely failed, since the `.catch` above resolves to `[]`).
  const personas: MentionGroup[] = orgPersonas.length
    ? [
        {
          type: "persona",
          label: "Personas",
          items: orgPersonas.map((persona) => ({
            type: "persona" as const,
            id: persona.slug,
            label: persona.name,
            href: personaInspectHref(persona.slug),
          })),
        },
      ]
    : demoPersonaGroup();

  const campaigns: MentionGroup = {
    type: "campaign",
    label: "Campaigns",
    items: campaignRefs.map((c) => ({ type: "campaign" as const, id: c.id, label: c.name, href: c.href })),
  };

  const crmGroups: MentionGroup[] = CRM_GROUPS.map((group) => ({
    type: group.type,
    label: language.crmObjects[group.key].label,
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

  return [campaigns, ...crmGroups, ...personas, vault].filter((g) => g.items.length > 0);
}
