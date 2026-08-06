export * from "./lead-ingestion";
export * from "./loss-classification";
export * from "./personas";
export * from "./persona-links";
export * from "./persona-profile";
export * from "./scoring";
export * from "./events";
export * from "./routing-decisions";
export * from "./integrity-findings";
export * from "./leads";
export * from "./notebook";
export * from "./campaign-kind";
export * from "./campaign-spine";
export * from "./campaign-revisions";
export * from "./revision-quote";
export * from "./media-annotation";
export * from "./campaign-rollup";
export * from "./campaign-results";
export * from "./arc-chat";
export * from "./arc-step-kind";
export * from "./arc-step-summary";
export * from "./arc-canvas";
export * from "./competitor-intel";
export * from "./attribution";
export * from "./journey";
export * from "./journey-collect";
export * from "./journey-snippet";
export * from "./journey-consent";
export * from "./campaign-drafts";
export * from "./campaign-from-opportunity";
export * from "./opportunity-package";
export * from "./opportunity-conversion";
export * from "./connector-catalog";
export * from "./campaign-assets";
export * from "./campaign-cta";
export * from "./agent-run-status";
export * from "./connections";
export * from "./connectors";
export * from "./connector-metering";
export * from "./companies";
export * from "./contacts";
export * from "./properties";
export * from "./jobs";
export * from "./outcomes";
export * from "./arc-tasks";
export * from "./media-ingest";
export * from "./asset-provenance";
export * from "./asset-approval";
export * from "./redaction";
export * from "./resend-webhook";
export * from "./board-demo";
export * from "./task-schedule";
export * from "./campaign-presentation";
export * from "./campaign-package";
export * from "./interactions";
export * from "./knowledge-graph";
export * from "./brain-recall";
export * from "./campaign-performance";
export * from "./brand-fonts";
export * from "./brand-logos";
export * from "./brand-kit";
export * from "./brand-design";
export * from "./creative-templates";
export * from "./creative-layout";
export * from "./dispatch-scheduling";
export * from "./opportunity-detection";
export * from "./nws-weather";
export * from "./rss-signals";
export * from "./news-search";
export * from "./review-signals";
export * from "./competitor-ads";
export * from "./crm-import";
export * from "./csv-import";
export * from "./import-presets";
export * from "./entity-import";
export * from "./enrichment";
export * from "./opportunity-kinds";
export * from "./opportunity-proposal";
export * from "./opportunity-briefing";
export * from "./performance-slicing";
export * from "./arc-levels";
export * from "./media-library";
export * from "./ai-usage";
export * from "./brain-ingestion";
export * from "./brain-provenance";
export * from "./brain-health";
export * from "./activation";
export * from "./arc-sharing";
export * from "./higgsfield-models";
export * from "./media-config";
export * from "./media-target";
export * from "./email-templates";
export * from "./crm-matching";
export * from "./custom-fields";
export * from "./custom-field-inference";
export * from "./object-labels";
export * from "./env-capabilities";
export * from "./pipeline-stages";
export * from "./audience-resolution";

export * from "./virality";

export * from "./plans";
export * from "./trial";
export * from "./billing-notice";

export * from "./oauth-refresh";

export * from "./exemplar-skills";

export * from "./auto-draft-selection";

export * from "./support";
// How a support request becomes a Linear ticket. Separate file, same feature —
// support.ts owns the request itself, this owns the ticket it turns into.
export * from "./support-linear";

export * from "./workspace-identity";
export * from "./branding-image";

// Inbound "which channel produced this signup" (BSR-586). Distinct from
// ./attribution above, which resolves which CAMPAIGN an outbound touchpoint
// belongs to — the two never share a symbol, but the names are close enough
// to be worth the signpost.
export * from "./signup-attribution";

// Pre-flight for arming ARC_BILLING_ENFORCEMENT (BSR-621).
export * from "./billing-enforcement-preflight";
export * from "./email-compliance";
// The address-keyed half of compliance: who must NOT be mailed, and why (BSR-482).
export * from "./email-suppression";
export * from "./lead-fit";
export * from "./arc-eval";
export * from "./brain-dedup";
export * from "./brain-dedup-backfill";

// The one place the user-facing approval vocabulary is decided (BSR-656).
// Import WORK_STATE_LABEL / toWorkState / countOf from here rather than
// spelling a status label into a component.
export * from "./vocabulary";

// Does a rendered string look like a stored value rather than language (BSR-709).
// The predicate behind the dev-only DOM check; the source scanners in
// plumbing-vocabulary.test.ts cannot see this class.
export * from "./identifier-leak";
export * from "./arc-prose";
export * from "./inline-fix";

// When an in-flight reply has actually died, so the bubble stops claiming work
// is happening. Read-side only — nothing here rewrites persisted state.
export * from "./arc-stalled-run";

// Searching message bodies, and the one definition of "flatten markdown for a
// narrow rail" shared with the thread preview.
export * from "./arc-message-search";

// One colour per persona, everywhere (BSR-661). Import personaAccent rather
// than re-deriving a hue from a regex ladder.
export * from "./persona-accent";

// What the app's invented words mean (BSR-659). Render with <Define>.
export * from "./definitions";

// Why an operator dismissed an opportunity, and what Arc should learn (BSR-686).
export * from "./dismissal-reasons";

// What the operator sent back, and why — corrections Arc should learn (BSR-685).
export * from "./correction-feedback";

// What a tool call's input/output looks like on screen: redacted, and summarised
// with the raw text behind a disclosure (BSR-724).
export * from "./tool-payload";

// How long a message keeps its payload (BSR-741).
export * from "./metadata-retention";

// Splitting a stored draft body into its lead-in fields and its copy, so the
// chat can render the deliverable instead of linking to it.
export * from "./arc-draft-content";

// What kind of thing a deliverable is, so a surface renders it as that medium
// rather than as a uniform box.
export * from "./arc-deliverable-medium";

// Whether a draft was actually checked. "No checks recorded" is not "checks
// passed", and the chat used to render both as nothing.
export * from "./arc-draft-checks";
