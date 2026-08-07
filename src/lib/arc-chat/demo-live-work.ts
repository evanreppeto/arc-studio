export type DemoRunKind = "think" | "search" | "match" | "draft" | "media" | "tool";

export type DemoRunRow = {
  id: string;
  label: string;
  detail?: string;
  status: "queued";
  kind: DemoRunKind;
};

export type DemoLiveWork = {
  commentary: string;
  rows: DemoRunRow[];
};

/**
 * The polite opening a request starts with, which the trace is about to say for
 * itself. "Draft an email for X" under a row already labelled "Preparing the
 * email draft" only needs to carry "X".
 *
 * Nothing past the opening is touched. An earlier version filtered a stopword
 * list across the *whole* sentence and kept the first six survivors, which
 * deleted prepositions out of the middle of the operator's own words: "Build a
 * multi-channel win-back campaign for stalled demo accounts" came back as
 * "Build multi-channel win-back campaign stalled demo", and the row read
 * "Preparing the campaign package for Build multi-channel win-back campaign
 * stalled demo". Its tests asserted the mangled strings, so it stayed green.
 */
const REQUEST_OPENER =
  /^(?:(?:please|hey|hi)\s+)*(?:(?:can|could|would)\s+you\s+)?(?:(?:i\s+(?:need|want)\s+(?:you\s+to\s+)?)|(?:let'?s\s+)|(?:go\s+ahead\s+and\s+))?(?:draft|write|rewrite|revise|create|make|build|compose|generate|design|put\s+together|prepare|find|search\s+for|look\s+up|research|show\s+me|give\s+me|tell\s+me|explain|analy[sz]e|compare|rank|score|summari[sz]e|review|check)\s+(?:me\s+)?(?:an|a|the|some|our|my)?\s*/iu;

/** Longest subject a single-line trace row reads comfortably at 11.5px. */
const SUBJECT_MAX = 64;

/**
 * The operator's own words, in their own order — the request with its opening
 * verb removed and nothing else changed. Always rendered inside quotation
 * marks by the callers below, so it never has to parse as a grammatical
 * continuation of our sentence.
 */
function requestSubject(request: string): string {
  const normalized = request.replace(/\s+/gu, " ").trim().replace(/[.?!]+$/u, "");
  const cleaned = normalized.replace(/^\/[\w-]+\s*/u, "");
  if (!cleaned) return "your request";
  // A skill supplies the verb, so what follows it opens on a bare determiner —
  // "/draft-email a note about…" leaves "a note about…" dangling.
  const fromCommand = cleaned !== normalized;

  const trimmed = cleaned
    .replace(REQUEST_OPENER, "")
    .replace(fromCommand ? /^(?:an|a|the|some|our|my)\s+/iu : /(?!)/u, "")
    .trim();
  // A request that is *only* its opening verb ("summarize") keeps that verb —
  // an empty subject would read worse than a terse one.
  const subject = trimmed || cleaned;
  if (subject.length <= SUBJECT_MAX) return subject;

  // Cut on a word boundary, never mid-word.
  const clipped = subject.slice(0, SUBJECT_MAX);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > 24 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

function sourcePlan(normalized: string): Array<{ id: string; label: string; detail: string; kind: DemoRunKind }> {
  const sources: Array<{ id: string; label: string; detail: string; kind: DemoRunKind }> = [];

  if (/(crm|lead|customer|homeowner|property|company|contact|audience)/u.test(normalized)) {
    sources.push({ id: "crm", label: "Checking the relevant CRM records", detail: "Matches stay tied to workspace data", kind: "match" });
  }
  if (/(campaign|email|sms|landing|social|ad|copy|brand|voice)/u.test(normalized)) {
    sources.push({ id: "brand", label: "Reading campaign and brand guidance", detail: "Claims, voice, and approval rules", kind: "tool" });
  }
  if (/(research|search|find|online|web|source|competitor|market|weather)/u.test(normalized)) {
    sources.push({ id: "research", label: "Searching connected research sources", detail: "Confirmed findings stay separate from inference", kind: "search" });
  }
  if (/(history|remember|previous|conversation|context)/u.test(normalized)) {
    sources.push({ id: "memory", label: "Recalling relevant conversation history", detail: "Using saved workspace memory", kind: "think" });
  }

  if (sources.length === 0) {
    sources.push({ id: "workspace", label: "Reading the relevant workspace context", detail: "Conversation, campaigns, and approved knowledge", kind: "think" });
  }

  return sources.slice(0, 2);
}

/** The article travels with the noun — "a SMS draft" and "a email draft" are
 *  the tell of a label assembled by string concatenation. */
function requestedChannel(normalized: string): { label: string; article: string } {
  if (/\bsms\b|text message/u.test(normalized)) return { label: "SMS draft", article: "an" };
  if (/\bemail\b/u.test(normalized)) return { label: "email draft", article: "an" };
  if (/landing page/u.test(normalized)) return { label: "landing-page draft", article: "a" };
  if (/social|post/u.test(normalized)) return { label: "social draft", article: "a" };
  if (/\bad\b|advert/u.test(normalized)) return { label: "ad draft", article: "an" };
  if (/campaign/u.test(normalized)) return { label: "campaign package", article: "a" };
  return { label: "draft", article: "a" };
}

/**
 * Build a deterministic preview trace from the operator's actual request.
 * This is used only by the no-backend demo, but it deliberately mirrors the
 * live runner's cumulative stream: interpret, ground, then execute.
 */
export function buildDemoLiveWork(request?: string | null): DemoLiveWork {
  const original = request?.trim() ?? "";
  const normalized = original.toLowerCase();
  const subject = requestSubject(original);
  const sources = sourcePlan(normalized);
  const rows: DemoRunRow[] = [
    {
      id: "interpret",
      label: `Interpreting “${subject}”`,
      detail: "Turning the request into a focused work plan",
      status: "queued",
      kind: "think",
    },
    ...sources.map((source) => ({ ...source, status: "queued" as const })),
  ];

  if (/(email|sms|campaign|draft|write|create|landing|social|\bad\b)/u.test(normalized)) {
    const channel = requestedChannel(normalized);
    rows.push({
      id: "produce",
      // No subject here. The row above already quoted the request, and naming it
      // twice produced "Preparing the email draft for email for the spring
      // property-manager campaign".
      label: `Preparing the ${channel.label}`,
      detail: "Review-ready and held behind approval",
      status: "queued",
      kind: "draft",
    });
    return {
      commentary: `I’m preparing ${channel.article} ${channel.label} for “${subject}”. I’ll ground it in the relevant workspace evidence, follow the approved voice and claims, and leave the result ready for review.`,
      rows,
    };
  }

  if (/(search|find|look up|research|which|who|audience|lead|compare)/u.test(normalized)) {
    rows.push({
      id: "synthesize",
      label: `Ranking findings for “${subject}”`,
      detail: "Confidence and source quality included",
      status: "queued",
      kind: "match",
    });
    return {
      commentary: `I’m researching “${subject}” across the sources that fit this request. I’ll keep confirmed findings distinct from inference and show what supports the result.`,
      rows,
    };
  }

  rows.push({
    id: "answer",
    label: `Preparing a grounded answer about “${subject}”`,
    detail: "Concise, source-aware, and specific to this conversation",
    status: "queued",
    kind: "draft",
  });
  return {
    commentary: `I’m working through “${subject}” using the active conversation and the most relevant workspace context. I’ll keep the reasoning focused on this request and make any assumptions visible.`,
    rows,
  };
}
