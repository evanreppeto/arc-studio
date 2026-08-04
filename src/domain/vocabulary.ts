/**
 * The one place the app's user-facing vocabulary is decided (BSR-656).
 *
 * Before this module the approval state had eleven names — "packages waiting",
 * "Waiting on you", "to decide", "Needs you", "Needs approval", "In review",
 * "need review", "Ready for review", "Awaiting your confirm", "Awaiting review",
 * "proposed" — and `/arc` rendered two of them ("Needs review" and "Ready for
 * review") on the same card, saying opposite things. The unit of work had four
 * names too: package, piece, asset, draft.
 *
 * Rules for anything added here:
 *   - A state is what a *user* would say, not what the column stores. Map the
 *     stored status to a state at the display boundary; never rename a DB value
 *     to match a label.
 *   - One state, one string. If a screen needs a longer form, derive it from the
 *     canonical label (see `needsYouCount` phrasing helpers below) rather than
 *     writing a second wording.
 *   - No internal nouns. `package` and `piece` are retired; a campaign holds
 *     assets. See `ASSET_NOUN`.
 *   - **A stored value becomes a user-facing string only through a mapper in
 *     this file, and that mapper must be registered in `STORED_VALUE_LABELLERS`
 *     at the bottom.** Rendering `{row.status}` directly is the bug that keeps
 *     recurring (BSR-655, BSR-693, BSR-709); a mapper defined here but left
 *     unregistered is the same bug with an extra step, so the totality test
 *     fails the build for it.
 *   - **A mapper must be total.** For any input — a value nobody predicted, an
 *     empty string, null — it returns language. Never the stored value, never
 *     nothing. An exhaustive lookup is a mapping plus a silent hole, and reality
 *     fills the hole on its own schedule.
 *
 * Pure — no I/O, no React. Display strings only.
 */

/**
 * The approval lifecycle as a user experiences it. Ordered the way work moves,
 * so a reader can see the pipeline in the type.
 */
export type WorkState =
  | "draft"
  | "needs_you"
  | "needs_changes"
  | "approved"
  | "scheduled"
  | "sending"
  | "sent"
  | "declined"
  | "archived";

/**
 * The canonical label for each state. These strings are the product's
 * vocabulary — changing one changes it everywhere, which is the point.
 *
 * `sending` covers what used to be split across "Live" and "Sending". A
 * campaign that is out in the world is sending; one word, used on the campaign
 * board and in the outbox alike.
 */
export const WORK_STATE_LABEL: Record<WorkState, string> = {
  draft: "Draft",
  needs_you: "Needs you",
  needs_changes: "Needs changes",
  approved: "Approved",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  declined: "Declined",
  archived: "Archived",
};

/**
 * One line saying what the state means, for tooltips, legends, and the glossary
 * in DESIGN.md. Written for someone who has never used marketing software.
 */
export const WORK_STATE_MEANING: Record<WorkState, string> = {
  draft: "Arc is still building this.",
  needs_you: "Arc finished it and is waiting for your decision.",
  needs_changes: "You asked for changes. Arc is reworking it.",
  approved: "You said yes. It has not gone out yet.",
  scheduled: "Approved and queued to go out at a set time.",
  sending: "Going out to customers now.",
  sent: "Already delivered.",
  declined: "You said no. Nothing will go out.",
  archived: "Put away. Nothing will go out.",
};

/**
 * The tone each state carries. Gold is the "needs you" cue and the one accent
 * per screen; green is healthy/done; grey is everything inert. Red is reserved
 * for destructive controls and never appears here — a declined item is a normal
 * outcome, not a warning (DESIGN.md §4, and BSR-661).
 */
export type WorkStateTone = "attention" | "ok" | "neutral";

export const WORK_STATE_TONE: Record<WorkState, WorkStateTone> = {
  draft: "neutral",
  needs_you: "attention",
  needs_changes: "attention",
  approved: "ok",
  scheduled: "ok",
  sending: "ok",
  sent: "ok",
  declined: "neutral",
  archived: "neutral",
};

export function workStateLabel(state: WorkState): string {
  return WORK_STATE_LABEL[state];
}

/**
 * Map a stored status string onto a user-facing state.
 *
 * Deliberately forgiving: statuses reach the UI from campaign rows, approval
 * items, dispatch rows, and Arc's own message payloads, and they have never
 * agreed on spelling ("pending_approval", "in_review", "submitted", "live",
 * "running"). Matching on substrings keeps one mapping instead of four.
 *
 * Order matters — the checks run most-specific first, because "pending_review"
 * matches both the review and the pending test.
 */
export function toWorkState(status: string | null | undefined): WorkState {
  const s = (status || "").toLowerCase();
  if (!s) return "draft";
  if (/archiv|paused/.test(s)) return "archived";
  if (/declin|reject/.test(s)) return "declined";
  // A compliance hold is on the OPERATOR's desk, not Arc's (BSR-755). The
  // guardrail that sets it flags "Human review required", Arc "may READ
  // approvals and ADD a recommendation, but never decides", and nothing
  // redrafts the item — it sits untouched until a person approves, revises or
  // declines it. Checked before the `blocked` branch below, which would
  // otherwise claim it.
  //
  // It stays visually distinct where a screen has room: the campaign detail
  // renders it red as "Blocked by a rule", because a compliance block is not a
  // routine pending item. That is a more specific rendering of a needs_you
  // item, not a different state.
  if (/compliance/.test(s)) return "needs_you";
  if (/revis|changes.request|blocked/.test(s)) return "needs_changes";
  if (/sent|delivered/.test(s)) return "sent";
  if (/live|active|sending|running|dispatch/.test(s)) return "sending";
  if (/schedul|queued/.test(s)) return "scheduled";
  if (/review|pending|await|submitted|proposed/.test(s)) return "needs_you";
  if (/approv|ready/.test(s)) return "approved";
  return "draft";
}

/** Convenience for the common "is this on my desk?" question. */
export function needsDecision(state: WorkState): boolean {
  return state === "needs_you" || state === "needs_changes";
}

/**
 * The unit of work inside a campaign. Was variously "package", "piece",
 * "asset", and "deliverable"; a campaign holds assets and nothing else.
 */
export const ASSET_NOUN = { one: "asset", many: "assets" } as const;

/**
 * What we call made-up numbers, in one word (BSR-656, same rule as the states).
 *
 * `/journeys` badged its funnel "demo data", Settings said "Sample data",
 * "Sample activity" and "Sample workspaces", and `/analytics` and `/crm`
 * rendered `710 leads` and `$225k won revenue` with no marking at all. Three
 * wordings and a silence, for one thing.
 *
 * The silence was the dangerous half: a reader has no way to tell an
 * illustrative number from their own, and the first thing they do with a real
 * number is believe it.
 */
export const DEMO_DATA_LABEL = "Demo data";

/** Said once, where the reader can act on it. Plain, not apologetic. */
export const DEMO_DATA_MEANING =
  "These numbers are illustrative, not yours. Connect a workspace to see real data.";

/** The campaign itself. Retires "package" as a user-facing noun. */
export const CAMPAIGN_NOUN = { one: "campaign", many: "campaigns" } as const;

/**
 * Elapsed days. Added because several surfaces interpolated the count straight
 * into a hard-coded "days" and rendered "1 days" — including the opportunity
 * title and summary, which are PERSISTED, so the disagreement is stored on the
 * row and read back by Arc rather than being a render-time slip (BSR-690).
 */
export const DAY_NOUN = { one: "day", many: "days" } as const;

export type CountableNoun = { one: string; many: string };

/** `countOf(1, ASSET_NOUN)` → "1 asset"; `countOf(4, ASSET_NOUN)` → "4 assets". */
export function countOf(count: number, noun: CountableNoun): string {
  return `${count} ${count === 1 ? noun.one : noun.many}`;
}

/**
 * The queue headline, in one voice. Home used four different phrasings of this
 * within a single screen ("4 packages waiting", "Waiting on you", "4 to decide",
 * "View all 4 waiting"); every one of them now comes from here.
 */
export function needsYouPhrase(count: number): string {
  return count === 1 ? "1 thing needs you" : `${count} things need you`;
}

// ---------------------------------------------------------------------------
// Arc run diagnostics
//
// The run-detail page (/arc/runs/[id]) is reachable by any signed-in customer
// from their own chat, and it rendered stored identifiers verbatim: a status of
// `complete`, a kicker reading `ask / standard`, recall kinds like `crm_lead`
// and `proof_point`, and tool names still carrying their protocol prefix
// (`mcp__arc__search_contacts`). A diagnostic page has to show what Arc did —
// that is the whole point — but "what Arc did" is the fact, not our spelling of
// it.
// ---------------------------------------------------------------------------

/** Short forms that should not be sentence-cased into "Crm" / "Sms". */
const ACRONYMS = new Set(["crm", "sms", "ai", "api", "url", "id", "cta", "seo", "roi", "mcp"]);

/**
 * Last-resort humanizer for a stored identifier: strip any `mcp__server__`
 * prefix, split snake_case and camelCase into words, sentence-case the result.
 *
 * Every map below falls back to this rather than rendering the raw value,
 * because these fields are open strings in practice — `route` is typed
 * `"fast" | "standard"` and the demo fixture already carries `"chat"`, and the
 * runner adds Brain node kinds without asking the app. An exhaustive lookup
 * would quietly print nothing, or the raw key, on the first new value.
 */
export function humanizeIdentifier(raw: string): string {
  const words = raw
    .replace(/^mcp__[^_]+__/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean);
  if (words.length === 0) return raw;
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

function labelled(map: Record<string, string>, value: string | null | undefined): string | null {
  // Whitespace counts as absent. A column holding " " used to survive the `!value`
  // check, miss the map, and come back out of the humanizer unchanged — so the
  // surface rendered an invisible gap where a word belongs, which reads as a
  // layout bug rather than as missing data. Found by the totality test (BSR-709).
  if (!value?.trim()) return null;
  return map[value] ?? humanizeIdentifier(value);
}

/** How the run finished. Prod only ever stores `complete` / `failed` here —
 *  `sent` belongs to the operator's own message — but all four are mapped. */
const RUN_STATUS_LABEL: Record<string, string> = {
  complete: "Finished",
  failed: "Failed",
  pending: "Still running",
  sent: "Sent",
};

/** What Arc was asked to do, not the enum we route on. */
const RUN_MODE_LABEL: Record<string, string> = {
  ask: "Answering a question",
  act: "Doing work",
  draft: "Drafting",
};

/** Which model tier served the run. Relevant to a customer as speed vs depth. */
const RUN_ROUTE_LABEL: Record<string, string> = {
  fast: "Fast model",
  standard: "Standard model",
};

/**
 * What a recalled memory *is*. Every value here was censused from prod, most
 * frequent first: learning, crm_lead, campaign_ref, persona, signal, crm_job,
 * proof_point, crm_contact, messaging_angle, crm_outcome, crm_company, arc.
 */
const RECALL_KIND_LABEL: Record<string, string> = {
  learning: "Something Arc learned",
  signal: "A signal Arc noticed",
  persona: "Persona",
  campaign_ref: "Campaign reference",
  proof_point: "Proof point",
  messaging_angle: "Messaging angle",
  crm_lead: "Lead",
  crm_contact: "Contact",
  crm_company: "Company",
  crm_job: "Job",
  crm_outcome: "Outcome",
  arc: "Arc's own note",
};

export function runStatusLabel(status: string | null | undefined): string {
  return labelled(RUN_STATUS_LABEL, status) ?? "Unknown";
}

export function runModeLabel(mode: string | null | undefined): string | null {
  return labelled(RUN_MODE_LABEL, mode);
}

export function runRouteLabel(route: string | null | undefined): string | null {
  return labelled(RUN_ROUTE_LABEL, route);
}

export function recallKindLabel(kind: string | null | undefined): string {
  return labelled(RECALL_KIND_LABEL, kind) ?? "Memory";
}

/**
 * `mcp__arc__search_contacts` → "Search contacts". `ToolSearch` stays as it is.
 *
 * A name already in camelCase or PascalCase was written by a person to be read —
 * `ToolSearch` is the tool's actual name, and sentence-casing it yields
 * "Toolsearch", which just looks like a typo. Only snake_case and dot.case names
 * are identifiers rather than names, and only those get rewritten.
 */
export function arcToolLabel(name: string): string {
  const bare = name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").replace(/^mcp__/, "") || name;
  if (/[a-z][A-Z]/.test(bare)) return bare;
  return humanizeIdentifier(bare);
}

/** Tool outcome, in the same words as the run's own status. */
const TOOL_STATUS_LABEL: Record<string, string> = {
  complete: "Done",
  error: "Failed",
  running: "Running",
};

export function toolStatusLabel(status: string | null | undefined): string {
  return labelled(TOOL_STATUS_LABEL, status) ?? "Unknown";
}

/**
 * What was under review, from `approval_items.item_type` (BSR-685).
 *
 * Arc's correction block quotes the operator's note back to it, and a note about
 * a picture is not guidance about copy — so the line has to say which. The
 * stored values are open-ended ("campaign_asset", "email_campaign_asset",
 * "media_asset", and whatever the next surface adds), which is exactly why this
 * matches on substrings and ends in a fallback rather than an exhaustive map.
 */
export const APPROVAL_ITEM_LABEL: Record<string, string> = {
  campaign_asset: "Creative",
  email_campaign_asset: "Email",
  media_asset: "Creative",
  campaign: "Campaign",
};

export function approvalItemLabel(itemType: string | null | undefined): string {
  const t = (itemType ?? "").trim().toLowerCase();
  if (!t) return "Draft";
  const exact = APPROVAL_ITEM_LABEL[t];
  if (exact) return exact;
  // Substring order matters: "email_campaign_asset" contains both "email" and
  // "campaign", and the channel is the more useful of the two to say.
  if (t.includes("email")) return "Email";
  if (t.includes("sms") || t.includes("text")) return "Text message";
  if (t.includes("media") || t.includes("asset") || t.includes("creative")) return "Creative";
  if (t.includes("campaign")) return "Campaign";
  return "Draft";
}

// ---------------------------------------------------------------------------
// The activity feed (BSR-734)
//
// What happened, in TWO shapes, because two surfaces need two grammars:
//
//   LABEL      a standalone noun phrase heading a list row  — "Changes requested"
//   PREDICATE  completes "You …" / "Arc …" in a feed that names the actor first
//
// Home renders `<b>{actor}</b> {text}` and was handed the label, so the front
// page read "You Approval Revision Requested" four times in a row — a stored
// enum, Title-Cased, templated into a sentence it does not fit. Both halves were
// wrong: the Title Case is what makes it look like a database value, and the
// noun phrase is what makes it ungrammatical after an actor.
//
// One string cannot do both jobs. "Changes requested" is a fine heading and a
// broken sentence; "asked for changes" is the reverse.
// ---------------------------------------------------------------------------

/** `approval_decisions.decision`. Census 2026-08-04: revision_requested, approved, archived, declined. */
const APPROVAL_DECISION_LABEL: Record<string, string> = {
  approved: "Approved",
  declined: "Declined",
  revision_requested: "Changes requested",
  reverted: "Decision reverted",
  archived: "Archived",
};

const APPROVAL_DECISION_PREDICATE: Record<string, string> = {
  approved: "approved a draft",
  declined: "declined a draft",
  revision_requested: "asked for changes",
  reverted: "reverted a decision",
  archived: "archived a draft",
};

/** `agent_run_logs.run_status`. Census 2026-08-04: completed, canceled. */
const RUN_ACTIVITY_LABEL: Record<string, string> = {
  completed: "Run finished",
  complete: "Run finished",
  canceled: "Run canceled",
  cancelled: "Run canceled",
  failed: "Run failed",
  queued: "Run queued",
  running: "Run started",
};

const RUN_ACTIVITY_PREDICATE: Record<string, string> = {
  completed: "finished a run",
  complete: "finished a run",
  canceled: "canceled a run",
  cancelled: "canceled a run",
  failed: "hit an error on a run",
  queued: "queued a run",
  running: "started a run",
};

/** `campaign_events.event_type`. Census 2026-08-04: ten distinct values, all mapped. */
const CAMPAIGN_EVENT_LABEL: Record<string, string> = {
  created: "Campaign created",
  asset_generated: "Draft created",
  approval_submitted: "Sent for approval",
  approval_decided: "Decision recorded",
  campaign_launched: "Campaign launched",
  dispatch_queued: "Send queued",
  dispatch_sent: "Message sent",
  dispatch_canceled: "Send canceled",
  dispatch_failed: "Send failed",
  archived: "Archived",
};

const CAMPAIGN_EVENT_PREDICATE: Record<string, string> = {
  created: "created a campaign",
  asset_generated: "drafted an asset",
  approval_submitted: "sent a draft for approval",
  approval_decided: "recorded a decision",
  campaign_launched: "launched a campaign",
  dispatch_queued: "queued a send",
  dispatch_sent: "sent a message",
  dispatch_canceled: "canceled a send",
  dispatch_failed: "hit a send failure",
  archived: "archived a campaign",
};

/**
 * A predicate for a value nobody wrote a case for.
 *
 * "recorded X" rather than X on its own, because the fallback has to stay
 * GRAMMATICAL after an actor name — "You some new state" is the same bug in a
 * new costume, and a fallback that reintroduces the bug is not a fallback.
 */
function predicateFallback(value: string): string {
  return `recorded ${humanizeIdentifier(value).toLowerCase()}`;
}

export function approvalDecisionActivityLabel(decision: string | null | undefined): string {
  return labelled(APPROVAL_DECISION_LABEL, decision) ?? "Decision recorded";
}

export function approvalDecisionActivityPredicate(decision: string | null | undefined): string {
  if (!decision?.trim()) return "recorded a decision";
  return APPROVAL_DECISION_PREDICATE[decision] ?? predicateFallback(decision);
}

export function runActivityLabel(status: string | null | undefined): string {
  return labelled(RUN_ACTIVITY_LABEL, status) ?? "Run logged";
}

export function runActivityPredicate(status: string | null | undefined): string {
  if (!status?.trim()) return "logged a run";
  return RUN_ACTIVITY_PREDICATE[status] ?? predicateFallback(status);
}

export function campaignEventActivityLabel(eventType: string | null | undefined): string {
  return labelled(CAMPAIGN_EVENT_LABEL, eventType) ?? "Campaign updated";
}

export function campaignEventActivityPredicate(eventType: string | null | undefined): string {
  if (!eventType?.trim()) return "updated a campaign";
  return CAMPAIGN_EVENT_PREDICATE[eventType] ?? predicateFallback(eventType);
}

// ---------------------------------------------------------------------------
// Campaign detail (BSR-742)
//
// Four stored columns reached the campaign screen verbatim. Values censused
// from prod 2026-08-04, counts in brackets.
//
//   campaign_assets.tool_source            arc_saved [34], creative_generator [8],
//                                          "Arc Orchestrator" [1], "Arc Demo Orchestrator" [9]
//   approval_recommendations.agent         draft-critic [6]
//   approval_recommendations.recommendation "request revision" [4], approve [2]
//   approval_recommendations.risk_flags[]  unsupported_claim [3], claim_risk [1]
//
// Note the mixed shapes in tool_source: some writers already store prose. That
// is exactly why every mapper here falls through to `humanizeIdentifier` rather
// than an exhaustive lookup — "Arc Orchestrator" must pass through untouched
// while `arc_saved` must not.
// ---------------------------------------------------------------------------

/** Where a deliverable came from, as the operator would say it. */
const ASSET_SOURCE_LABEL: Record<string, string> = {
  arc_saved: "Saved from a chat",
  creative_generator: "Generated creative",
  approved_media: "Approved media",
  library: "From your library",
};

/**
 * Who is advising on this deliverable.
 *
 * `draft-critic` is the independent claims reviewer — the read-model only counts
 * a `draft-critic` row as a real review, because `recommend_on_approval` writes
 * as `arc` and Arc's own note must not read as an independent check of Arc's own
 * work. The label keeps that distinction visible.
 */
const REVIEW_AGENT_LABEL: Record<string, string> = {
  "draft-critic": "Arc's claims reviewer",
  arc: "Arc",
};

/** What the reviewer is advising. Slots after "… recommends". */
const REVIEW_VERDICT_LABEL: Record<string, string> = {
  approve: "approval",
  "request revision": "changes",
  request_revision: "changes",
  decline: "declining it",
  reject: "declining it",
};

/** Why a deliverable is flagged. These are the operator's risk vocabulary. */
const RISK_FLAG_LABEL: Record<string, string> = {
  unsupported_claim: "Claim we cannot back up",
  claim_risk: "Risky claim",
  embedded_text: "Text baked into the image",
  logo_issue: "Logo problem",
  privacy: "Someone identifiable",
  unrealistic_scene: "Scene looks staged",
};

/**
 * Where a deliverable came from, or null when nothing is recorded — the meta
 * line omits the segment rather than printing a placeholder.
 *
 * `tool_source` holds BOTH shapes in prod: `arc_saved` and `creative_generator`
 * are identifiers, `Arc Orchestrator` and `Arc Demo Orchestrator` are prose a
 * person wrote. So this cannot just fall through to `humanizeIdentifier` the way
 * the other mappers do — that sentence-cases the prose into "Arc orchestrator",
 * which reads as a typo. Same reasoning as `arcToolLabel` and `ToolSearch`:
 * something already written to be read is a name, not a key.
 */
export function assetSourceLabel(source: string | null | undefined): string | null {
  const raw = source?.trim();
  if (!raw) return null;
  const mapped = ASSET_SOURCE_LABEL[raw];
  if (mapped) return mapped;
  // Whitespace means someone wrote it as words. Leave it exactly as written.
  if (/\s/.test(raw)) return raw;
  return humanizeIdentifier(raw);
}

export function reviewAgentLabel(agent: string | null | undefined): string {
  return labelled(REVIEW_AGENT_LABEL, agent) ?? "A reviewer";
}

export function reviewVerdictLabel(verdict: string | null | undefined): string {
  return labelled(REVIEW_VERDICT_LABEL, verdict) ?? "a decision";
}

export function riskFlagLabel(flag: string | null | undefined): string {
  return labelled(RISK_FLAG_LABEL, flag) ?? "Flagged for review";
}

// ---------------------------------------------------------------------------
// The registry (BSR-709, option B)
//
// Every mapper above turns a value the database stores into something a person
// reads. The rule this registry exists to enforce is that such a mapper must be
// TOTAL: for any input at all — a value nobody predicted, an empty string, null —
// it returns language, never the stored value and never nothing.
//
// That property is not theoretical. `route` is typed `"fast" | "standard"` and
// the demo fixture already carries `"chat"`; `ArcRecall.kind` is typed `string`
// and prod holds twelve distinct values, four of which post-date the code that
// reads them. An exhaustive lookup renders `undefined` the first time reality
// adds a value, which is how the raw key reached the screen in the first place.
//
// Registering a mapper here does three things: `vocabulary.test.ts` proves it is
// total, the same test proves its output would not trip the dev DOM check, and
// `pnpm census:vocabulary` can ask prod which real values still have no label.
// ---------------------------------------------------------------------------

export type StoredValueLabeller = {
  /** The exported function's name, so a failure says which mapper is wrong. */
  name: string;
  /** Where the value comes from, for the census script to query. */
  source: string;
  /** The explicit labels. Anything outside this falls through to the humanizer. */
  map: Record<string, string>;
  /**
   * Whether the surface may render nothing for this field. `runModeLabel`
   * returns null on purpose so the run kicker can omit a segment rather than
   * print an em-dash; the rest must always produce a word.
   */
  nullable: boolean;
  label: (value: string | null | undefined) => string | null;
};

export const STORED_VALUE_LABELLERS: StoredValueLabeller[] = [
  { name: "runStatusLabel", source: "arc_messages.status", map: RUN_STATUS_LABEL, nullable: false, label: runStatusLabel },
  { name: "runModeLabel", source: "arc_messages.metadata->>mode", map: RUN_MODE_LABEL, nullable: true, label: runModeLabel },
  { name: "runRouteLabel", source: "arc_messages.metadata->>route", map: RUN_ROUTE_LABEL, nullable: true, label: runRouteLabel },
  { name: "recallKindLabel", source: "arc_messages.metadata->recall[].kind", map: RECALL_KIND_LABEL, nullable: false, label: recallKindLabel },
  { name: "toolStatusLabel", source: "arc_messages.metadata->toolCalls[].status", map: TOOL_STATUS_LABEL, nullable: false, label: toolStatusLabel },
  {
    name: "approvalItemLabel",
    source: "approval_items.item_type",
    map: APPROVAL_ITEM_LABEL,
    nullable: false,
    label: approvalItemLabel,
  },
  // The activity feed's two grammars. Both halves are registered: a predicate is
  // just as capable of printing a stored value as a label, and it reaches the
  // front page (BSR-734).
  {
    name: "approvalDecisionActivityLabel",
    source: "approval_decisions.decision",
    map: APPROVAL_DECISION_LABEL,
    nullable: false,
    label: approvalDecisionActivityLabel,
  },
  {
    name: "approvalDecisionActivityPredicate",
    source: "approval_decisions.decision",
    map: APPROVAL_DECISION_PREDICATE,
    nullable: false,
    label: approvalDecisionActivityPredicate,
  },
  {
    name: "runActivityLabel",
    source: "agent_run_logs.run_status",
    map: RUN_ACTIVITY_LABEL,
    nullable: false,
    label: runActivityLabel,
  },
  {
    name: "runActivityPredicate",
    source: "agent_run_logs.run_status",
    map: RUN_ACTIVITY_PREDICATE,
    nullable: false,
    label: runActivityPredicate,
  },
  {
    name: "campaignEventActivityLabel",
    source: "campaign_events.event_type",
    map: CAMPAIGN_EVENT_LABEL,
    nullable: false,
    label: campaignEventActivityLabel,
  },
  {
    name: "campaignEventActivityPredicate",
    source: "campaign_events.event_type",
    map: CAMPAIGN_EVENT_PREDICATE,
    nullable: false,
    label: campaignEventActivityPredicate,
  },
  // Campaign detail (BSR-742). `assetSourceLabel` is the one nullable entry
  // here: the meta line omits the segment entirely rather than printing a
  // placeholder where a provenance would go.
  {
    name: "assetSourceLabel",
    source: "campaign_assets.tool_source",
    map: ASSET_SOURCE_LABEL,
    nullable: true,
    label: assetSourceLabel,
  },
  {
    name: "reviewAgentLabel",
    source: "approval_recommendations.agent",
    map: REVIEW_AGENT_LABEL,
    nullable: false,
    label: reviewAgentLabel,
  },
  {
    name: "reviewVerdictLabel",
    source: "approval_recommendations.recommendation",
    map: REVIEW_VERDICT_LABEL,
    nullable: false,
    label: reviewVerdictLabel,
  },
  {
    name: "riskFlagLabel",
    source: "approval_recommendations.risk_flags[]",
    map: RISK_FLAG_LABEL,
    nullable: false,
    label: riskFlagLabel,
  },
  {
    name: "arcToolLabel",
    source: "arc_messages.metadata->toolCalls[].name",
    // No fixed map — tool names are open-ended by design, so every one of them
    // goes through the humanizer. Registered anyway because the totality and
    // no-identifier-out properties matter just as much here.
    map: {},
    nullable: false,
    label: (value) => (value?.trim() ? arcToolLabel(value) : "Unknown"),
  },
];
