/**
 * Golden questions: catch Arc's answer quality degrading (BSR-507).
 *
 * The only technique that has ever caught a silent Arc failure is asking a
 * question whose answer we already know. Five stacked failures in Arc's
 * production path were invisible to tests, logs, health checks and CI, and were
 * found exactly that way (`docs/ARC-SILENT-FAILURES.md`). This turns that lucky
 * habit into a standing suite.
 *
 * ── The guardrail, and why it is the whole design ────────────────────────────
 * Grading is against GROUND TRUTH — literal facts seeded into the smoke tenant —
 * never against another model's opinion of a good answer. A judge model shares
 * the bug and agrees with it: ask a broken Arc "was that a good answer?" and it
 * says yes. So every assertion here is string containment over known data.
 *
 * That makes grading blunt: it checks whether the fact is present, not whether
 * the prose is good. That is deliberate. Phrasing is not what breaks.
 *
 * ── Why questions must not contain their own answers ─────────────────────────
 * If a fact appears in the question, a model that retrieved nothing can still
 * "pass" by echoing the prompt back. That was previously a hand-curation habit
 * ("none of them appear in the question"); `selfAnsweringFacts` makes it a
 * property the test suite enforces, so a question added in a hurry cannot
 * quietly become worthless.
 */

export type ArcCapability =
  | "crm"
  | "brain"
  | "campaigns"
  | "multi-hop";

export type GoldenQuestion = {
  id: string;
  capability: ArcCapability;
  /** Asked verbatim. Must never contain any of its own answers. */
  question: string;
  /** Ground truth: literal strings seeded into the smoke tenant. */
  facts: string[];
  /** How many of `facts` must appear. */
  minHits: number;
  /** Facts that must EVERY one appear, for questions with a single right answer. */
  requireAll?: string[];
  /** Why this question earns its place in the suite. */
  why: string;
};

/**
 * A reply can arrive, read fluently, and still be a retrieval break. These are
 * the shapes that mean "Arc did not get the data" regardless of what else the
 * answer contains — including the failure text added by the tool-expectation
 * guard (BSR-508), which is a real failure surfacing exactly as intended.
 */
const RETRIEVAL_FAILURE_PATTERNS: Array<{ pattern: RegExp; meaning: string }> = [
  { pattern: /RETRIEVAL FAILED/i, meaning: "a tool reported a retrieval failure (BSR-508 guard)" },
  { pattern: /isn't connected to this workspace|is not connected to this workspace/i, meaning: "Arc reported the workspace as not connected" },
  { pattern: /\bno access to\b|\bdon'?t have access\b|\black(?:s|ing)? access\b/i, meaning: "Arc reported it lacks access" },
  { pattern: /\bI (?:can'?t|cannot) (?:retrieve|access|reach|see)\b/i, meaning: "Arc reported it could not retrieve the data" },
  { pattern: /\bunable to (?:retrieve|access|reach)\b/i, meaning: "Arc reported it was unable to retrieve the data" },
];

/**
 * Facts seeded into the ARCHIVED smoke tenant (`big-shoulders-restoration`,
 * org 63b72a45…) and frozen since 2026-07-06. Nothing writes to that org but the
 * nightly run, which is what makes these answers stable.
 *
 * These are read from the real database, not invented — companies, trusted Brain
 * nodes, and campaign state as they actually exist there.
 */
export const GOLDEN_QUESTIONS: GoldenQuestion[] = [
  {
    id: "crm-partners",
    capability: "crm",
    question: "List the plumbing partner companies in our CRM by name.",
    facts: [
      "Rapid Response Plumbing",
      "Lakeside Mechanical",
      "Halsted Drain & Sewer",
      "North Shore Pipeworks",
      "Windy City Plumbing Co",
      "Ravenswood Rooter",
      "Southside Water & Gas",
      "Cicero Plumbing Partners",
    ],
    minHits: 2,
    why: "The original golden question. Names come only from retrieval over the seeded CRM — none appear in the prompt.",
  },
  {
    id: "crm-lead-count",
    capability: "crm",
    question: "How many leads are in the CRM in total?",
    facts: ["200"],
    minHits: 1,
    requireAll: ["200"],
    why:
      "Counting is answered from the list envelope's `total`, not by counting a capped page. Arc once reported " +
      "'at least 64 leads' against a real 200 by counting a truncated fragment; this pins the exact number.",
  },
  {
    id: "brain-certification",
    capability: "brain",
    question: "Are our restoration technicians certified? Say which certification.",
    facts: ["IICRC"],
    minHits: 1,
    requireAll: ["IICRC"],
    why: "A single distinctive token that exists only in a trusted Brain node. Recall failure is unmissable.",
  },
  {
    id: "brain-reviews",
    capability: "brain",
    question: "What is our aggregate customer rating, and across how many reviews?",
    facts: ["4.9", "380"],
    minHits: 2,
    requireAll: ["4.9", "380"],
    why:
      "Two independent numbers from one proof point. Requiring both makes a plausible-but-invented figure fail, " +
      "which a single loose number would not.",
  },
  {
    id: "brain-response-time",
    capability: "brain",
    question: "How quickly do we respond to emergency calls? Quote the proof we hold.",
    facts: ["60 minutes", "24/7", "under 60"],
    minHits: 1,
    why: "Retrieval of a proof point Arc is expected to reuse in outbound copy. Phrasing varies, so any form counts.",
  },
  {
    id: "campaign-approved",
    capability: "multi-hop",
    question: "Which partner company has a referral campaign already approved and waiting to go out?",
    facts: ["North Shore Pipeworks", "Halsted Drain & Sewer"],
    minHits: 1,
    why:
      "Two hops: campaign state plus the company it belongs to. The company name is the fact, so the answer cannot " +
      "come from echoing the question's own words.",
  },
];

export type GoldenGrade = {
  id: string;
  capability: ArcCapability;
  passed: boolean;
  hits: string[];
  missing: string[];
  /** Why it failed, in one line an operator can act on. Null when it passed. */
  failure: string | null;
};

/**
 * Normalize for comparison only — case and whitespace vary freely in prose and
 * are never the thing that broke. Nothing else is stripped: punctuation and
 * digits are load-bearing in facts like "4.9" and "Halsted Drain & Sewer".
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function contains(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

/**
 * Facts a question gives away in its own text. Any hit here is worthless — the
 * model can satisfy it by echoing. Used by the test suite to reject a
 * self-answering question at build time rather than trusting it at run time.
 */
export function selfAnsweringFacts(question: GoldenQuestion): string[] {
  const all = [...question.facts, ...(question.requireAll ?? [])];
  return [...new Set(all.filter((fact) => contains(question.question, fact)))];
}

/**
 * Grade one answer against ground truth.
 *
 * Retrieval failure is checked FIRST and overrides everything: a reply that says
 * "I couldn't retrieve that" while still naming a partner is a break, not a
 * partial success, and must not be graded on its hits.
 */
export function gradeGoldenAnswer(question: GoldenQuestion, answer: string): GoldenGrade {
  const base = { id: question.id, capability: question.capability };
  const text = answer ?? "";

  if (!text.trim()) {
    return { ...base, passed: false, hits: [], missing: question.facts, failure: "Arc returned an empty answer" };
  }

  for (const { pattern, meaning } of RETRIEVAL_FAILURE_PATTERNS) {
    if (pattern.test(text)) {
      return { ...base, passed: false, hits: [], missing: question.facts, failure: meaning };
    }
  }

  const hits = question.facts.filter((fact) => contains(text, fact));
  const missing = question.facts.filter((fact) => !contains(text, fact));

  const missingRequired = (question.requireAll ?? []).filter((fact) => !contains(text, fact));
  if (missingRequired.length) {
    return {
      ...base,
      passed: false,
      hits,
      missing,
      failure: `missing required fact${missingRequired.length > 1 ? "s" : ""}: ${missingRequired.join(", ")}`,
    };
  }

  if (hits.length < question.minHits) {
    return {
      ...base,
      passed: false,
      hits,
      missing,
      failure: `expected at least ${question.minHits} known fact${question.minHits > 1 ? "s" : ""}, found ${hits.length}`,
    };
  }

  return { ...base, passed: true, hits, missing, failure: null };
}

export type GoldenRunSummary = {
  total: number;
  passed: number;
  failed: number;
  /** True when every question that ran passed. */
  ok: boolean;
  /** One line per question, ready for a CI job summary. */
  lines: string[];
};

/**
 * Roll grades up for reporting. Per-question, deliberately: a suite that only
 * says "3 of 6 failed" hides WHICH capability is degrading, and slow
 * degradation in one area is the thing this suite exists to make visible.
 */
export function summarizeGoldenRun(grades: GoldenGrade[]): GoldenRunSummary {
  const passed = grades.filter((g) => g.passed).length;
  const lines = grades.map((g) =>
    g.passed
      ? `PASS  ${g.id} (${g.capability}) — matched: ${g.hits.join(", ")}`
      : `FAIL  ${g.id} (${g.capability}) — ${g.failure}`,
  );
  return { total: grades.length, passed, failed: grades.length - passed, ok: passed === grades.length, lines };
}
