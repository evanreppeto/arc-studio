export const ARC_SKILL_IDS = {
  companyResearch: "company-research",
  opportunityDiscovery: "opportunity-discovery",
  approvalGatedDrafting: "approval-gated-drafting",
  skillAuthoring: "skill-authoring",
} as const;

export type ArcSkillId = (typeof ARC_SKILL_IDS)[keyof typeof ARC_SKILL_IDS];

export type ArcSkillDefinition = {
  /** Product-facing identity. Several focused skills may share one runner playbook. */
  key: string;
  id: ArcSkillId;
  name: string;
  description: string;
  prompt: string;
  commands: readonly string[];
  mode: "ask" | "act" | "draft";
  /** `generated` = built by Arc from this workspace's own campaign history. */
  source: "built-in" | "library" | "system" | "github" | "generated";
  publisher?: string;
  /**
   * Connector keys (from `src/domain/connectors.ts`) this skill cannot do its
   * stated job without. Resolved against live workspace status by
   * `unmetSkillConnectors` so an unmet source is named before the turn runs —
   * it never blocks the run.
   *
   * Declare a connector here only when the skill's *description* becomes untrue
   * without it. A skill that merely works better with a source should stay
   * silent; a false warning on every run is worse than no warning.
   */
  requiresConnectors?: readonly string[];
  /** Present for workspace-installed GitHub skills and generated exemplar skills.
   *  Kept out of the visible chat message, but injected into the runner request
   *  behind a read-only skill. */
  instructions?: string;
  /** GitHub-imported skills only. Generated skills have no upstream repository. */
  repositoryUrl?: string;
};

/**
 * Product-facing metadata for the skills the runner can execute today. Keep
 * this next to command routing so the Skills screen never advertises a skill
 * that the agent cannot actually receive.
 */
export const ARC_SKILLS: readonly ArcSkillDefinition[] = [
  {
    key: "company-research",
    id: ARC_SKILL_IDS.companyResearch,
    name: "Company research",
    description: "Research companies, summarize signals, and recall workspace context.",
    prompt: "Research a company and summarize the strongest signals for our team.",
    commands: ["/research-company", "/summarize", "/signals"],
    mode: "ask",
    source: "built-in",
    // The only built-in whose primary verb is external. The other seven read
    // workspace records and stay silent by design — a warning on every run of
    // the most-used skills would train operators to ignore this signal.
    requiresConnectors: ["gemini-research"],
  },
  {
    key: "opportunity-discovery",
    id: ARC_SKILL_IDS.opportunityDiscovery,
    name: "Opportunity discovery",
    description: "Find, rank, and explain the leads most worth acting on next.",
    prompt: "Find and rank the strongest opportunities in our workspace right now.",
    commands: ["/find-leads", "/opportunities", "/score"],
    mode: "act",
    source: "built-in",
  },
  {
    key: "audience-builder",
    id: ARC_SKILL_IDS.opportunityDiscovery,
    name: "Audience builder",
    description: "Create a focused, explainable audience from CRM and signal data.",
    prompt: "Build a focused audience for this goal and explain the inclusion criteria.",
    commands: ["/build-audience", "/segment"],
    mode: "act",
    source: "built-in",
  },
  {
    key: "persona-intelligence",
    id: ARC_SKILL_IDS.companyResearch,
    name: "Persona intelligence",
    description: "Turn workspace evidence into a useful persona brief and messaging angle.",
    prompt: "Create a persona brief from our workspace evidence and recommend the strongest messaging angle.",
    commands: ["/persona", "/persona-brief"],
    mode: "ask",
    source: "built-in",
  },
  {
    key: "campaign-builder",
    id: ARC_SKILL_IDS.approvalGatedDrafting,
    name: "Campaign builder",
    description: "Create a review-ready multi-channel campaign package.",
    prompt: "Draft a review-ready campaign package for the opportunity we should pursue next.",
    commands: ["/draft-campaign", "/draft-email", "/follow-up"],
    mode: "draft",
    source: "built-in",
  },
  {
    key: "asset-studio",
    id: ARC_SKILL_IDS.approvalGatedDrafting,
    name: "Asset studio",
    description: "Draft on-brand creative assets without sending or publishing them.",
    prompt: "Create an on-brand draft asset for this request and keep it review-gated.",
    commands: ["/create-asset", "/assets"],
    mode: "draft",
    source: "built-in",
  },
  {
    key: "performance-analysis",
    id: ARC_SKILL_IDS.opportunityDiscovery,
    name: "Performance analysis",
    description: "Explain campaign results, drivers, and the next best experiment.",
    prompt: "Analyze our recent performance, explain the main drivers, and recommend the next experiment.",
    commands: ["/performance", "/analyze-results"],
    mode: "ask",
    source: "built-in",
  },
  {
    key: "approval-review",
    id: ARC_SKILL_IDS.companyResearch,
    name: "Approval review",
    description: "Summarize pending work, risks, and the decisions needed from your team.",
    prompt: "Show me what is waiting for approval, summarize the risks, and recommend the next decision.",
    commands: ["/whats-pending", "/review-work"],
    mode: "ask",
    source: "built-in",
  },
];

/** Curated skills users can add to their workspace from Arc's online library. */
export const ARC_SKILL_LIBRARY: readonly ArcSkillDefinition[] = [
  {
    key: "competitor-watch",
    id: ARC_SKILL_IDS.companyResearch,
    name: "Competitor watch",
    description: "Track competitor launches, messaging shifts, and notable market signals.",
    prompt: "Research our named competitors, identify meaningful changes, and cite the strongest signals.",
    commands: ["/watch-competitors"],
    mode: "ask",
    source: "library",
    publisher: "Arc Labs",
    // "Track competitor launches and messaging shifts" is not something the
    // workspace's own records can answer.
    requiresConnectors: ["competitor-ads"],
  },
  {
    key: "local-search-audit",
    id: ARC_SKILL_IDS.companyResearch,
    name: "Local search audit",
    description: "Review local visibility and turn gaps into a prioritized improvement plan.",
    prompt: "Audit our local search presence and create a prioritized, source-backed improvement plan.",
    commands: ["/local-search-audit"],
    mode: "ask",
    source: "library",
    publisher: "Arc Labs",
    // Local visibility is read from the review/reputation profiles, not the CRM.
    requiresConnectors: ["reviews-signals"],
  },
  {
    key: "review-response-planner",
    id: ARC_SKILL_IDS.approvalGatedDrafting,
    name: "Review response planner",
    description: "Draft thoughtful, brand-safe responses to customer reviews for approval.",
    prompt: "Draft brand-safe responses to these customer reviews and keep every response review-gated.",
    commands: ["/review-responses"],
    mode: "draft",
    source: "library",
    publisher: "Arc Community",
    // There is nothing to respond to without the reviews themselves.
    requiresConnectors: ["reviews-signals"],
  },
  {
    key: "proposal-follow-up",
    id: ARC_SKILL_IDS.approvalGatedDrafting,
    name: "Proposal follow-up",
    description: "Build a review-ready follow-up sequence around an open proposal.",
    prompt: "Create a concise follow-up sequence for this open proposal using the workspace's real context.",
    commands: ["/proposal-follow-up"],
    mode: "draft",
    source: "library",
    publisher: "Arc Community",
  },
  {
    key: "content-repurposer",
    id: ARC_SKILL_IDS.approvalGatedDrafting,
    name: "Content repurposer",
    description: "Turn one approved source into channel-ready drafts without inventing claims.",
    prompt: "Repurpose this approved source into channel-ready drafts while preserving its facts and voice.",
    commands: ["/repurpose-content"],
    mode: "draft",
    source: "library",
    publisher: "Arc Labs",
  },
  {
    key: "storm-signal-monitor",
    id: ARC_SKILL_IDS.opportunityDiscovery,
    name: "Storm signal monitor",
    description: "Turn fresh weather and property signals into ranked, reviewable opportunities.",
    prompt: "Review the latest storm and property signals and rank the most actionable opportunities.",
    commands: ["/storm-monitor"],
    mode: "act",
    source: "library",
    publisher: "Signal Works",
    // Only the weather source is required. The "property signals" half is the
    // `permit-data` connector, which fabricates opportunities and must not be
    // recommended — a skill requirement is an invitation to switch it on.
    requiresConnectors: ["weather-signals"],
  },
];

/** System workflow shown in the slash menu and on the Skills screen. */
export const ARC_SKILL_BUILDER: ArcSkillDefinition = {
  key: "skill-authoring",
  id: ARC_SKILL_IDS.skillAuthoring,
  name: "Create a skill",
  description: "Build a reusable Arc workflow through a guided conversation.",
  prompt: "Help me create a reusable Arc skill.",
  commands: ["/create-skill"],
  mode: "ask",
  source: "system",
  publisher: "Arc",
};

/** System workflow that turns a public GitHub SKILL.md URL into a reviewed,
 * workspace-installed skill. The composer handles the install locally instead
 * of asking the runner to claim it changed workspace configuration. */
export const ARC_SKILL_INSTALLER: ArcSkillDefinition = {
  key: "skill-installation",
  id: ARC_SKILL_IDS.skillAuthoring,
  name: "Add a skill",
  description: "Review and install a public SKILL.md from GitHub.",
  prompt: "Paste a public GitHub URL for the SKILL.md you want Arc to review and add.",
  commands: ["/add-skill"],
  mode: "ask",
  source: "system",
  publisher: "Arc",
};

export const ALL_ARC_SKILLS: readonly ArcSkillDefinition[] = [
  ...ARC_SKILLS,
  ...ARC_SKILL_LIBRARY,
  ARC_SKILL_BUILDER,
  ARC_SKILL_INSTALLER,
];

const COMMAND_SKILLS: Record<string, ArcSkillId> = Object.fromEntries(
  ALL_ARC_SKILLS.flatMap((skill) => skill.commands.map((command) => [command.replace(/^\//, ""), skill.id])),
);

export function arcSkillForCommand(command: string | null | undefined): ArcSkillDefinition | null {
  const id = typeof command === "string" ? command.trim().replace(/^\//, "") : "";
  if (!id) return null;
  return ALL_ARC_SKILLS.find((skill) => skill.commands.some((candidate) => candidate.replace(/^\//, "") === id)) ?? null;
}

export function arcSkillForKey(key: string | null | undefined): ArcSkillDefinition | null {
  const id = typeof key === "string" ? key.trim() : "";
  if (!id) return null;
  return ALL_ARC_SKILLS.find((skill) => skill.key === id) ?? null;
}

export function skillIdForArcCommand(command: string | null | undefined): ArcSkillId | null {
  const id = typeof command === "string" ? command.trim().replace(/^\//, "") : "";
  if (!id) return null;
  return COMMAND_SKILLS[id] ?? null;
}
