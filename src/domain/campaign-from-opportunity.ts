import { type RestorationFocus } from "./campaign-drafts";
import { humanizePersonaLabel, isAllowedPersona, OFFICIAL_PERSONA_MAPPINGS } from "./personas";

/**
 * Pure mapping from a surfaced opportunity to the seed fields for an
 * approval-gated campaign draft. Deterministic and I/O-free so it's identical
 * whether it runs in the page (to pre-fill the confirm modal) or the server
 * action (to author the authoritative draft). Nothing here sends anything —
 * this only shapes a draft the operator still has to approve.
 */

export type OpportunitySeedInput = {
  title: string;
  summary: string;
  recommendedAction: string;
  urgency: "low" | "medium" | "high";
  /** Opportunity evidence persona (an enum key like `persona_property_manager`), if any. */
  persona?: string | null;
  /** DB `recommended_campaign_type`, if the detector set one. */
  recommendedCampaignType?: string | null;
  /**
   * The signal's own geography (e.g. `evidence.area` on a weather opportunity).
   * Recorded alongside the service areas, never treated as the target.
   */
  signalArea?: string | null;
  /**
   * `business_profiles.service_areas`. Optional so existing callers keep
   * compiling, but its absence is visible in the summary rather than silent —
   * an unscoped campaign says so.
   */
  serviceAreas?: readonly string[] | null;
};

export type CampaignSeed = {
  /** Editable draft name, pre-filled from the opportunity title. */
  name: string;
  /** Official persona mapping, or "" when the opportunity has none (operator picks). */
  persona: string;
  /** Inferred `restoration_focus`, or "" when nothing matched (operator picks). */
  restorationFocus: RestorationFocus | "";
  /** Industry-neutral theme shown to operators and stored on new campaigns. */
  campaignTheme: string;
  /** The message angle — carries the opportunity's recommended action verbatim. */
  angle: string;
  /** Human-readable audience note for the campaign's `audience_summary`. */
  audienceSummary: string;
  /** Suggested campaign type label for display + provenance. */
  campaignType: string;
};

/** How many service areas to name before collapsing the rest into a count. */
const MAX_NAMED_SERVICE_AREAS = 6;

/**
 * State the geography a campaign actually targets (BSR-756).
 *
 * A signal-driven campaign used to inherit the SIGNAL's geography. On prod a
 * flood campaign was scoped to "Chicagoland" off an advisory covering Cook,
 * DuPage and Will, while every one of the workspace's 18 service areas is a City
 * of Chicago neighbourhood — so a geo-targeted spend would have bought
 * impressions in two counties the business does not serve. Nothing on the path
 * read `business_profiles.service_areas`, which had held the answer for a day.
 *
 * ── Why this does not compute an intersection ────────────────────────────────
 * It cannot, honestly. NWS publishes by county ("Cook, IL"); a workspace lists
 * whatever it calls its patch ("Lakeview", "the North Shore", "SE Portland").
 * There is no containment data relating the two, and no reliable way to derive
 * it from strings. Code that claimed "Lakeview ⊂ Cook, IL" would be inventing
 * geography, which is the failure this ticket exists to stop, one level up.
 *
 * So: name what we serve, name what the signal covered, and state the rule that
 * decides between them. The operator can see both and judge; nothing is asserted
 * that was not read from a record.
 */
export function describeServiceAreaScope(input: {
  /** The signal's own geography, e.g. an NWS alert area. */
  signalArea?: string | null;
  /** `business_profiles.service_areas` — whatever the workspace calls its patch. */
  serviceAreas?: readonly string[] | null;
}): string {
  const areas = (input.serviceAreas ?? []).map((a) => (typeof a === "string" ? a.trim() : "")).filter(Boolean);
  const signal = (input.signalArea ?? "").trim();

  if (areas.length === 0) {
    // Silence here is how the original bug read as fine. An unset service area
    // is a real gap and the campaign should say so rather than imply coverage.
    return signal
      ? `Service area is not set on the Brand Kit, so targeting scope is unverified. The signal covered ${signal} — confirm what is actually serviceable before spending against it.`
      : "Service area is not set on the Brand Kit, so targeting scope is unverified.";
  }

  const named = areas.slice(0, MAX_NAMED_SERVICE_AREAS).join(", ");
  const rest = areas.length - MAX_NAMED_SERVICE_AREAS;
  const coverage = `Targeting our service areas only: ${named}${rest > 0 ? ` +${rest} more` : ""}.`;

  return signal
    ? `${coverage} The signal covered ${signal}; anything outside our service areas is excluded.`
    : coverage;
}

// Specific → generic. First match wins, so "storm surge" beats bare "storm",
// and "water backup" beats the generic "water" fallback.
const FOCUS_KEYWORDS: Array<[RegExp, RestorationFocus]> = [
  [/\b(?:burst|frozen|broken)\s+pipe|pipe\s+burst\b/, "burst_pipe"],
  [/\bsewage|sewer\b/, "sewage"],
  [/\bstorm\s+surge\b/, "storm_surge"],
  [/\bflash[-\s]?flood|flood(?:ing|ed|water|s)?\b/, "flood"],
  [/\bstorm|hail|hailstorm|wind[-\s]?driven\b/, "storm_surge"],
  [/\bmold|mildew\b/, "mold"],
  [/\bfire|smoke\s+damage\b/, "fire"],
  [/\bstanding\s+water\b/, "standing_water"],
  [/\bwater\s*[-\s]?backup|back[-\s]?up\b/, "water_backup"],
  [/\bwater\b/, "water_backup"],
];

/** Infer a `restoration_focus` from opportunity copy, or "" when nothing matches. */
export function inferRestorationFocus(text: string): RestorationFocus | "" {
  const t = (text || "").toLowerCase();
  for (const [re, focus] of FOCUS_KEYWORDS) {
    if (re.test(t)) return focus;
  }
  return "";
}

/** Turn a persona enum key into a readable label (e.g. `persona_hoa_board` → "HOA board"). */
function personaLabel(persona: string): string {
  return humanizePersonaLabel(persona);
}

function humanize(value: string): string {
  const s = (value || "").replace(/[_-]+/g, " ").trim();
  const sentence = s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  // `re_engagement` humanizes to "Re engagement", which is not a word. The
  // underscore there joins a prefix rather than separating two words, so put the
  // hyphen back: "Re-engagement".
  return sentence.replace(/^Re (?=[a-z])/, "Re-");
}

const MAX_CAMPAIGN_NAME = 96;
const MAX_SUBJECT = 48;

/**
 * The thing a campaign is *about*, pulled out of an opportunity headline.
 *
 * Opportunity titles are written to be scanned in an inbox — "Dana Whitfield
 * (Southside Water & Gas) — quiet 53 days" tells a reviewer why it surfaced.
 * As a campaign name that is noise: the "quiet 53 days" is the trigger, not the
 * campaign. Prefer the parenthetical (the company), else the head before the
 * dash, which is where these titles put their subject.
 */
function subjectFromTitle(title: string): string {
  const clean = (title || "").replace(/\s+/g, " ").trim();

  // A parenthetical is usually the company ("Dana Whitfield (Southside Water &
  // Gas)") — but not always: "Naperville hail swath (Jun 14)" parenthesizes a
  // date, which named a campaign "Storm rapid response — Jun 14". Digits are a
  // good enough tell for dates and counts; a company name rarely needs one, and
  // when it does the dash fallback below still produces something sane.
  const parenthetical = clean.match(/\(([^)]{2,})\)/)?.[1]?.trim();
  if (parenthetical && !/\d/.test(parenthetical) && parenthetical.length <= MAX_SUBJECT) {
    return parenthetical;
  }

  // Split on a spaced dash (em, en, or hyphen) — the separator these titles use
  // between subject and rationale. A hyphen inside a word ("Insurance-agent")
  // is untouched because it has no surrounding spaces. Any parenthetical left in
  // the head is dropped: it was rejected above precisely because it isn't the
  // subject.
  const head = (clean.split(/\s[—–-]\s/)[0] ?? "").replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  if (head && head !== clean && head.length <= MAX_SUBJECT) return head;
  return "";
}

/**
 * Concise, editable campaign name. Reads "<theme> — <subject>", matching how
 * operator-created campaigns are already named, instead of restating the
 * opportunity headline verbatim.
 *
 * Falls back to the cleaned title whenever a subject can't be pulled out
 * confidently — a slightly long name beats a confidently wrong one, and the
 * field is editable either way.
 */
function suggestCampaignName(title: string, theme: string): string {
  const clean = (title || "").replace(/\s+/g, " ").trim();
  const subject = subjectFromTitle(clean);
  const themeLabel = (theme || "").trim();
  const composed = subject && themeLabel ? `${themeLabel} — ${subject}` : "";
  const name = composed || clean;
  if (name.length <= MAX_CAMPAIGN_NAME) return name;
  return `${name.slice(0, MAX_CAMPAIGN_NAME - 2).trim()}…`;
}

/** A single suggested campaign-type label — the detector's value if present, else by urgency. */
function suggestCampaignType(
  urgency: OpportunitySeedInput["urgency"],
  recommendedCampaignType?: string | null,
): string {
  const explicit = (recommendedCampaignType ?? "").trim();
  if (explicit) return humanize(explicit);
  if (urgency === "high") return "Rapid response";
  if (urgency === "medium") return "Targeted outreach";
  return "Nurture sequence";
}

/**
 * Build the seed for a campaign draft from an opportunity. `persona` and
 * `restorationFocus` come back as "" when the opportunity gives no confident
 * value, so the confirm modal can require the operator to choose.
 */
export function buildCampaignSeedFromOpportunity(
  input: OpportunitySeedInput,
  allowedPersonaKeys: readonly string[] = OFFICIAL_PERSONA_MAPPINGS,
): CampaignSeed {
  const persona = isAllowedPersona(input.persona, allowedPersonaKeys) ? input.persona : "";
  const restorationFocus = inferRestorationFocus(
    `${input.title} ${input.summary} ${input.recommendedAction}`,
  );
  const campaignTheme = input.recommendedCampaignType?.trim()
    ? humanize(input.recommendedCampaignType)
    : restorationFocus
      ? humanize(restorationFocus)
      : suggestCampaignType(input.urgency, null);
  const label = persona ? personaLabel(persona) : "";
  const who = label
    ? `${label} — matched by Arc from this opportunity signal.`
    : "Audience sourced from an Arc opportunity signal.";
  // WHO, then WHERE. The persona half was always here; the geography half is
  // what a signal-driven campaign silently inherited from the signal (BSR-756).
  const audienceSummary = `${who} ${describeServiceAreaScope({
    signalArea: input.signalArea,
    serviceAreas: input.serviceAreas,
  })}`.trim();

  return {
    name: suggestCampaignName(input.title, campaignTheme),
    persona,
    restorationFocus,
    campaignTheme,
    angle: (input.recommendedAction || "").trim(),
    audienceSummary,
    campaignType: suggestCampaignType(input.urgency, input.recommendedCampaignType),
  };
}
