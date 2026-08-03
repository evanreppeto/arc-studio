// The tenant-scoping contract, as data (BSR-638).
//
// WHY THIS FILE EXISTS
//
// docs/backend-workspace-data-boundary-audit.md stated "a workspace owns ... CRM
// references" from 2026-07-05 to 2026-08-03 while every CRM table was org-only the
// whole time. Nobody noticed, because nothing checked. A boundary that lives only
// in prose is not a boundary. This file is the machine-readable version, and
// scripts/check-tenancy-contract.mjs holds the database to it.
//
// THE RULE (BSR-637)
//
//   An org owns the customer record. A workspace owns everything generated from it.
//
//   If two workspaces in the same company could legitimately DISAGREE about a row,
//   the row is workspace-owned. If disagreeing would just mean one of them is
//   wrong, it is org-owned.
//
// HOW TO ADD A TABLE
//
// Add it here in the same commit that creates it. The check fails on any public
// table missing from this map — that is the whole point, so please don't reach for
// the escape hatch of dropping it in "unclassified" to get a green build.
//
//   "org"          org_id NOT NULL, and NO workspace_id.
//   "workspace"    org_id NOT NULL and workspace_id NOT NULL. org_id stays so the
//                  existing is_org_member(org_id) RLS predicate keeps working;
//                  workspace_id narrows within it.
//   "inherits"     No scoping column. Isolated by a NOT NULL foreign key to an
//                  "org" or "workspace" row, and only ever read through it. Name
//                  the parent. If it ever gains a direct read path, reclassify.
//   "platform"     Genuinely not tenant-scoped. Gate any UI on ARC_PLATFORM_ADMIN_EMAILS.
//   "unclassified" Dead or unwired. MUST NOT be referenced from src/ or apps/ —
//                  tenancy-contract.test.ts enforces that. Classify it before
//                  wiring it, not after.
//
// `pending` marks a table whose category is decided but whose columns have not
// been migrated yet. It relaxes the column assertion and nothing else, and the
// check prints the outstanding count on every run so the remaining work stays
// visible instead of quietly becoming permanent.

/** Shared reason for the tables awaiting the Group A / Group B boundary migration. */
const GROUP_A = "BSR-637 Group A — gains workspace_id in the boundary migration";
const GROUP_B = "BSR-637 Group B — workspace_id/org_id exists but is still nullable";

export const TENANCY_CONTRACT = {
  // ── Category 1: org-owned — the customer record layer ────────────────────
  // Shared by every workspace in the org. All already compliant; none move.
  companies: "org",
  contacts: "org",
  leads: "org",
  jobs: "org",
  properties: "org",
  outcomes: "org",
  crm_notes: "org",
  crm_tasks: "org",
  crm_activities: "org",
  custom_field_definitions: "org",
  custom_field_values: "org",
  pipeline_stages: "org",
  personas: "org",
  persona_definitions: "org",
  journey_identities: "org",
  journey_touchpoints: "org",
  engagement_events: "org",
  events: "org",
  integrity_findings: "org",
  routing_decisions: "org",
  connections: "org",
  google_drive_connections: "org",
  google_drive_sources: "org",
  app_settings: "org",
  org_onboarding_state: "org",
  org_plans: "org",
  organization_memberships: "org",
  // Compliance policy, not brand voice: a workspace may ADD rules, never subtract.
  // Flagged as a close call in the audit doc — revisit if per-workspace additions
  // are wanted (nullable workspace_id, NULL meaning org-wide).
  guardrail_rules: "org",
  // The workspace registry itself belongs to an org.
  workspaces: "org",

  // ── Category 2: workspace-owned — everything generated ───────────────────
  campaigns: "workspace",
  campaign_assets: { category: "workspace", pending: GROUP_A },
  campaign_events: { category: "workspace", pending: GROUP_A },
  campaign_dispatches: { category: "workspace", pending: GROUP_A },
  campaign_results: { category: "workspace", pending: GROUP_A },
  approval_items: { category: "workspace", pending: GROUP_A },
  approval_decisions: { category: "workspace", pending: GROUP_A },
  approval_recommendations: { category: "workspace", pending: GROUP_A },
  agent_outputs: { category: "workspace", pending: GROUP_A },
  knowledge_nodes: { category: "workspace", pending: GROUP_A },
  knowledge_edges: { category: "workspace", pending: GROUP_A },
  vault_notes: { category: "workspace", pending: GROUP_A },
  arc_generated_skills: { category: "workspace", pending: GROUP_A },
  agents: { category: "workspace", pending: GROUP_A },
  agent_task_inputs: { category: "workspace", pending: GROUP_A },
  agent_task_events: { category: "workspace", pending: GROUP_A },
  agent_run_logs: { category: "workspace", pending: GROUP_A },
  opportunities: { category: "workspace", pending: GROUP_A },
  next_best_actions: { category: "workspace", pending: GROUP_A },
  persona_snapshots: { category: "workspace", pending: GROUP_A },
  persona_knowledge_entries: { category: "workspace", pending: GROUP_A },
  competitor_campaigns: { category: "workspace", pending: GROUP_A },
  // Creative brand identity that constrains generation — distinct from
  // workspaces.logo_url, which is UI chrome. Two brands, two profiles.
  business_profiles: { category: "workspace", pending: GROUP_A },
  media_assets: { category: "workspace", pending: GROUP_A },
  media_folders: { category: "workspace", pending: GROUP_A },
  arc_instances: "workspace",
  agent_tasks: "workspace",
  agent_connections: "workspace",
  agent_api_tokens: "workspace",
  workspace_invites: "workspace",
  workspace_memberships: "workspace",
  arc_conversations: { category: "workspace", pending: GROUP_B },
  arc_messages: { category: "workspace", pending: GROUP_B },
  arc_projects: { category: "workspace", pending: GROUP_B },
  arc_saved_items: { category: "workspace", pending: GROUP_B },
  audit_events: { category: "workspace", pending: GROUP_B },
  support_requests: { category: "workspace", pending: GROUP_B },
  ai_usage_events: { category: "workspace", pending: GROUP_B },
  connector_usage_events: { category: "workspace", pending: GROUP_B },
  connector_spend_budgets: { category: "workspace", pending: GROUP_B },
  workspace_connectors: { category: "workspace", pending: GROUP_B },
  workspace_media_config: { category: "workspace", pending: GROUP_B },

  // Import provenance (BSR-640). An import artifact belongs to the workspace that
  // triggered the run — the connector is configured per workspace even though the
  // CRM rows it writes are org-owned, so the run is the only place that answers
  // "where did these 400 contacts come from".
  //
  // external_systems and external_object_mappings were Category 5 dead scaffold
  // until now; they were built for exactly this and never wired. Reviving them had
  // to pick a category first, which is the rule this contract exists to enforce —
  // and it enforced it on the very next ticket after it shipped.
  import_runs: "workspace",
  import_run_records: "workspace",
  external_systems: "workspace",
  external_object_mappings: "workspace",

  // ── Category 3: inherits tenancy through a parent FK ─────────────────────
  // Every currently-wired table without a scoping column is in here. The check
  // must not demand columns of them, or it gets switched off as noise.
  campaign_shares: { category: "inherits", parent: "campaigns" },
  campaign_audiences: { category: "inherits", parent: "campaigns" },
  arc_conversation_shares: { category: "inherits", parent: "arc_conversations" },
  arc_project_shares: { category: "inherits", parent: "arc_projects" },
  agent_task_label_assignments: { category: "inherits", parent: "agent_tasks" },

  // These two were classified "inherits" first, on the strength of having a
  // foreign key to a tenant-scoped parent. The check rejected both on its very
  // first run, correctly: their parent FKs are NULLABLE, so a row could exist
  // attached to nothing and belonging to no tenant. guardrail_findings was the
  // worse case — all FOUR of its parents are nullable and it is actively written
  // by src/lib/arc-api/draft-review.ts.
  //
  // "Has an FK to a scoped parent" is not the test. "Has a NOT NULL FK to a
  // scoped parent" is. Both carry their own columns as of BSR-653.
  guardrail_findings: "workspace",
  partner_health_snapshots: "org",

  // ── Category 4: platform, deliberately not tenant-scoped ─────────────────
  organizations: "platform",
  profiles: "platform",
  waitlist_signups: "platform",
  platform_events: "platform",
  // A storm is a fact about the world, not about a tenant. weather_event_targets
  // is what maps one to a tenant.
  weather_events: "platform",
  integration_registry: "platform",

  // ── Category 5: unclassified — dead or unwired ───────────────────────────
  // Empty, and referenced nowhere outside the generated database.types.ts.
  // Classify before wiring; tenancy-contract.test.ts fails if one is referenced.
  ad_platform_actions: "unclassified",
  ad_spend_decisions: "unclassified",
  agent_permissions: "unclassified",
  agent_tool_requests: "unclassified",
  analytics_snapshots: "unclassified",
  audits: "unclassified",
  capacity_snapshots: "unclassified",
  competitor_apps: "unclassified",
  competitor_features: "unclassified",
  nurture_enrollments: "unclassified",
  nurture_sequences: "unclassified",
  partner_referral_submissions: "unclassified",
  partner_referral_tokens: "unclassified",
  personalization_rules: "unclassified",
  rejected_intake_events: "unclassified",
  score_weight_configs: "unclassified",
  social_accounts: "unclassified",
  social_posts: "unclassified",
  software_research_notes: "unclassified",
  task_labels: "unclassified",
  tracking_links: "unclassified",
  visitor_persona_contexts: "unclassified",
  weather_event_targets: "unclassified",
  // The other half of the import scaffold. external_systems and
  // external_object_mappings graduated to Category 2 in BSR-640; sync_conflicts
  // stays here until something actually reconciles a two-way sync.
  sync_conflicts: "unclassified",
  // Ad-hoc backups from the 2026-07-29 status migration, created by hand — they
  // exist in prod but no migration builds them, so a fresh database does not have
  // them. RLS is DISABLED and `anon` holds full DML, verified AS the role: it can
  // read all 325 rows and could truncate them.
  //
  // Deliberately NOT called a leak. The tables have exactly two columns, `id` and
  // `status` — no names, emails or phone numbers — and every row belongs to the
  // archived seed org. It is bad hygiene and a pattern that would leak next time,
  // not an exposure of anyone's data.
  //
  // Kept in the contract rather than ignored so that the one thing which cannot
  // see them stays visible: assertion 5 of rls-cross-tenant.sql only checks tables
  // carrying org_id, and these carry none. Deletion tracked in BSR-651.
  status_backup_20260729_jobs: "unclassified",
  status_backup_20260729_leads: "unclassified",
  status_backup_20260729_outcomes: "unclassified",
};

/** Categories that require a tenant column, and which columns those are. */
export const REQUIRED_COLUMNS = {
  org: { required: ["org_id"], forbidden: ["workspace_id"] },
  workspace: { required: ["org_id", "workspace_id"], forbidden: [] },
  inherits: { required: [], forbidden: [] },
  platform: { required: [], forbidden: [] },
  unclassified: { required: [], forbidden: [] },
};

export const CATEGORIES = Object.keys(REQUIRED_COLUMNS);

/** Normalize the shorthand string form to the object form. */
export function entryFor(table) {
  const raw = TENANCY_CONTRACT[table];
  if (raw === undefined) return null;
  return typeof raw === "string" ? { category: raw } : raw;
}
