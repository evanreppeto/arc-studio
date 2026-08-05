export type ArcSkillApprovalPolicy = "read_only" | "propose_only" | "approval_gated_drafts";

export type ArcSkill = {
  id: string;
  name: string;
  description: string;
  businessAgnostic: true;
  approvalPolicy: ArcSkillApprovalPolicy;
  allowedTools: readonly string[];
  instructions: readonly string[];
  outputContract: readonly string[];
};

export const ARC_SKILLS: readonly ArcSkill[] = [
  {
    id: "skill-authoring",
    name: "Skill authoring",
    description: "Guide an operator through defining a safe, reusable Arc workflow.",
    businessAgnostic: true,
    approvalPolicy: "propose_only",
    allowedTools: ["get_app_map", "get_workspace_settings", "emit_card", "suggest_followups", "ask_operator"],
    instructions: [
      "Use this skill only when the operator wants to create or revise a reusable Arc skill.",
      "Gather the skill name, trigger, required context, ordered instructions, expected output, and approval rules. Ask focused questions when any of these are missing.",
      "Return a concise skill specification the operator can review before installation. Never claim the skill is installed until the product confirms it.",
      "Keep the workflow business-agnostic unless the operator explicitly grounds it in workspace context.",
    ],
    outputContract: [
      "Provide a proposed name, slash command, purpose, trigger, inputs, ordered instructions, tools or connectors, output contract, and approval policy.",
      "Clearly label assumptions and unresolved questions.",
      "End by asking the operator to approve or revise the proposed specification.",
    ],
  },
  {
    id: "company-research",
    name: "Company research",
    description: "Research a company, market, or prospect using public and workspace sources.",
    businessAgnostic: true,
    approvalPolicy: "propose_only",
    allowedTools: ["research_web", "emit_card", "cite_sources", "suggest_followups", "ask_operator"],
    instructions: [
      "Use this skill when the operator wants source-backed research about a company, category, market, or prospect.",
      "Stay neutral to the workspace's industry. Let the business context and operator goal define what matters.",
      "Do not create or edit CRM records, drafts, media, or opportunities from this skill alone.",
    ],
    outputContract: [
      "Return source-backed findings with citations.",
      "Separate confirmed facts from inferences.",
      "Name open questions that would require operator judgment or another skill.",
    ],
  },
  {
    id: "opportunity-discovery",
    name: "Opportunity discovery",
    description: "Survey internal context plus research signals and propose reviewable opportunities.",
    businessAgnostic: true,
    approvalPolicy: "propose_only",
    allowedTools: [
      "search_companies",
      "search_contacts",
      "search_leads",
      "search_jobs",
      "search_outcomes",
      "search_properties",
      "query_brain",
      "list_opportunities",
      "read_persona_intelligence",
      "read_recent_activity",
      "read_performance",
      "get_app_map",
      "get_workspace_settings",
      "research_web",
      "propose_opportunity",
      "emit_card",
      "cite_sources",
      "suggest_followups",
      "ask_operator",
    ],
    instructions: [
      "Use this skill to turn workspace context and source-backed research into pending opportunities.",
      "Treat every proposed opportunity as review-only until a human approves the next step.",
      "Prefer a few high-confidence proposals over broad unranked lists.",
    ],
    outputContract: [
      "Each opportunity must include the signal, audience, recommended action, confidence, and evidence.",
      "Cite the internal record or public source behind each material claim.",
      "Do not draft campaigns, generate media, update CRM records, send, publish, launch, or spend.",
    ],
  },
  {
    id: "approval-gated-drafting",
    name: "Approval-gated drafting",
    description: "Create draft work products from approved context without publishing or sending.",
    businessAgnostic: true,
    approvalPolicy: "approval_gated_drafts",
    allowedTools: [
      "query_brain",
      "list_campaigns",
      "get_campaign",
      "list_approvals",
      "list_media",
      "attach_media",
      "list_brand_documents",
      "read_brand_document",
      "get_app_map",
      "get_workspace_settings",
      "create_campaign_draft",
      "generate_image",
      "generate_video",
      // Required, not optional, alongside generate_image: the prompt tells Arc
      // that a request to put a logo / phone number / any words onto an existing
      // image MUST go through compose_creative, because image generation is
      // hardened to strip text and logos and a regenerated background silently
      // drops the request. Without it here the allowlist removed the only tool
      // that can satisfy that instruction, and every branding revision ended in
      // Arc correctly reporting it had no way to do the work (BSR-759).
      "compose_creative",
      "analyze_website",
      "propose_brand_profile",
      "emit_card",
      "cite_sources",
      "suggest_followups",
      "ask_operator",
    ],
    instructions: [
      "Use this skill when the operator explicitly wants draft work products.",
      "Drafts must stay approval-gated and tied to the current workspace context.",
      "Use the workspace's brand, media, and campaign context instead of inventing facts.",
    ],
    outputContract: [
      "Every created work product must be pending human approval.",
      "Explain the source context and assumptions behind the draft.",
      "Do not approve, send, publish, launch, unlock dispatch, or spend.",
    ],
  },
  {
    id: "campaign-package-drafting",
    name: "Campaign package drafting",
    description:
      "Draft a complete, approval-gated campaign package — brief, audience, persona logic, channel copy, and approved-media references — from workspace context.",
    businessAgnostic: true,
    approvalPolicy: "approval_gated_drafts",
    allowedTools: [
      "query_brain",
      "search_companies",
      "search_contacts",
      "search_leads",
      "read_persona_intelligence",
      "read_performance",
      "list_campaigns",
      "get_campaign",
      "list_brand_documents",
      "read_brand_document",
      "list_media",
      "attach_media",
      "get_app_map",
      "get_workspace_settings",
      "create_campaign_draft",
      "emit_card",
      "cite_sources",
      "suggest_followups",
      "ask_operator",
    ],
    instructions: [
      "Use this skill when the operator wants a complete, reviewable campaign package rather than a single asset.",
      "Derive the target and lookalike audience from workspace records and persona intelligence, and state the persona and relationship logic explicitly — never write to a generic \"everyone\".",
      "Copywriting: lead with the audience's situation and the single most relevant value, not a feature list; give each asset one primary call to action; build on the workspace's real proof points and approved media, and never invent claims, statistics, or offers.",
      "Email: structure the email as a sequence with a distinct job per message (hook and context, then value and proof, then objection or social proof, then call to action), and define the entry trigger, cadence, and exit or branch conditions — not a single blast.",
      "Respect each channel's constraints: SMS brevity, subject-line length, ad character limits, and landing-page scannability.",
      "Build from the workspace's brand, media, and campaign history; if a required input is missing, ask the operator instead of fabricating it.",
    ],
    outputContract: [
      "Each package must include the brief, the target and lookalike audiences considered, the persona and relationship logic, an email draft expressed as a sequence, an SMS draft, paid or ad copy, landing or one-pager copy, a sales or partner handoff note, and an asset list referencing approved media.",
      "Cite the internal record or public source behind each material claim, and separate confirmed facts from assumptions.",
      "Reference approved media; do not generate net-new media from this skill.",
      "Every package stays pending human approval. Do not approve, send, publish, launch, unlock dispatch, or spend.",
    ],
  },
];

const SKILLS_BY_ID = new Map(ARC_SKILLS.map((skill) => [skill.id, skill]));

export function resolveArcSkill(skillId: string | null | undefined): ArcSkill | null {
  const id = typeof skillId === "string" ? skillId.trim() : "";
  if (!id) return null;
  const skill = SKILLS_BY_ID.get(id);
  if (!skill) {
    throw new Error(`Unknown Arc skill: ${id}`);
  }
  return skill;
}
