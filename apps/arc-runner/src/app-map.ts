/**
 * Arc's map of the app: every operator-facing surface, what it's for, where it
 * lives (deep-link route), and which tools read/write it. Single source of truth
 * for wayfinding ("where do I do X / take me to Y") and the coverage backbone the
 * later slices plug into. Routes mirror the app's real nav; the app-map.test.ts
 * drift test keeps the tool names honest against the real runner tool registry.
 */
export type ArcSurfaceApproval = "read_only" | "direct_write" | "proposes_to_approval";

export type ArcSurface = {
  id: string;
  label: string;
  purpose: string;
  route: string;
  reads: readonly string[];
  writes: readonly string[];
  approval: ArcSurfaceApproval;
};

export const ARC_APP_MAP: readonly ArcSurface[] = [
  {
    id: "crm",
    label: "CRM",
    purpose:
      "Companies, contacts, leads, jobs, outcomes, and properties — the record of who the business serves.",
    route: "/crm",
    reads: [
      "search_companies",
      "search_contacts",
      "search_leads",
      "get_lead",
      "search_jobs",
      "search_outcomes",
      "search_properties",
    ],
    writes: ["create_lead", "update_record", "log_interaction"],
    approval: "direct_write",
  },
  {
    id: "campaigns",
    label: "Campaigns",
    purpose: "Approval-gated campaign packages and their draft assets across channels.",
    route: "/campaigns",
    reads: ["list_campaigns", "get_campaign", "list_approvals", "get_approval"],
    writes: ["create_campaign_draft", "submit_draft", "generate_image", "generate_video", "edit_image", "submit_ad_variants", "recommend_on_approval"],
    approval: "proposes_to_approval",
  },
  {
    id: "library",
    label: "Library",
    purpose:
      "The business's real, approved media (photos, video, logos, docs) Arc reuses as authentic proof.",
    route: "/library",
    reads: ["list_media"],
    writes: ["attach_media"],
    approval: "proposes_to_approval",
  },
  {
    id: "brand",
    label: "Brand",
    purpose: "Brand identity, voice, proof points, and the source documents Arc learns the brand from.",
    route: "/brand",
    reads: ["list_brand_documents", "read_brand_document"],
    writes: ["analyze_website", "propose_brand_profile"],
    approval: "proposes_to_approval",
  },
  {
    id: "personas",
    label: "Personas",
    purpose: "The business's customer personas and their revenue-intelligence segments, scores, and signals.",
    route: "/personas",
    reads: ["read_persona_intelligence"],
    writes: [],
    approval: "read_only",
  },
  {
    id: "brain",
    label: "Brain",
    purpose: "Arc's marketing knowledge graph — durable learnings, signals, and the facts that ground its work.",
    route: "/brain",
    reads: ["query_brain"],
    writes: ["record_brain_note", "link_brain_nodes"],
    approval: "direct_write",
  },
  {
    id: "opportunities",
    label: "Opportunities",
    purpose: "The source-backed opportunity inbox Arc surveys and proposes into, plus competitor intelligence it records.",
    route: "/opportunities",
    reads: ["list_opportunities"],
    writes: ["propose_opportunity", "record_competitor_intel"],
    approval: "proposes_to_approval",
  },
  {
    id: "performance",
    label: "Performance",
    purpose: "Outcome and channel/persona performance Arc cites before proposing a next iteration.",
    route: "/analytics",
    reads: ["read_performance"],
    writes: [],
    approval: "read_only",
  },
  {
    id: "settings",
    label: "Settings",
    purpose:
      "Workspace configuration — connectors, Brand Kit status, compliance rules, team, and agent behavior. Read-only to Arc; changes are human-only.",
    route: "/settings",
    reads: ["get_workspace_settings"],
    writes: [],
    approval: "read_only",
  },
];
