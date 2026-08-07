import { ARC_SKILL_IDS, type ArcSkillId } from "./catalog";

/**
 * Infers which runner playbook a plain-language operator turn belongs to, so a
 * skill can apply without the operator typing a slash command.
 *
 * Why this is only five-way: the app catalog has 16 product-facing skills, but
 * every one resolves to one of the `ARC_SKILL_IDS` playbooks the runner
 * actually executes. Routing therefore never has to discriminate 16 ways — it
 * picks a playbook (or nothing).
 *
 * ── Conservatism is the whole design ──────────────────────────────────────
 * Returning `null` reproduces today's behavior exactly (no skill block, full
 * mode tool set), so `null` is always the safe answer. A wrong pick is strictly
 * worse than no pick. Every threshold here is tuned to abstain: a winner needs
 * both an absolute score floor and a clear margin over the runner-up, and ties
 * abstain.
 *
 * This module is pure and deterministic — no I/O, no model call, no clock. It
 * is safe to replay over historical messages, which is how its vocabulary and
 * thresholds were chosen rather than guessed.
 */

/**
 * Weighted signal phrases, by tier:
 *   3 — a verb+object that names the work ("draft a campaign", "find leads").
 *   2 — a distinctive verb or noun that usually implies the playbook.
 *   1 — supporting vocabulary that alone must never decide anything.
 *
 * Bare nouns stay cheap on purpose. "campaign" appears in "draft a campaign"
 * and in "how did the campaign do" — the verb is the discriminator, so a noun
 * can support a decision but never carry one.
 */
type PhraseTier = readonly [strong: readonly string[], medium: readonly string[], weak: readonly string[]];

/**
 * Ordered word pairs that count as a strong signal when they appear close
 * together, e.g. ["draft", "campaign"].
 *
 * Exact phrases alone are too brittle for real operator writing: "draft a short
 * email campaign" — the most clearly-marketing message in the prod corpus —
 * missed every `draft a * campaign` phrase because of one adjective, and scored
 * only on bare "draft". Proximity absorbs the modifiers people actually write.
 */
type NearPair = readonly [string, string];

const WEIGHTS = [3, 2, 1] as const;
/** How far apart a NearPair may sit and still read as one idea. Four words
 *  covers "draft a short email campaign" and "add our real logo" without
 *  reaching across a sentence boundary into an unrelated clause. */
const MAX_NEAR_GAP = 4;
const NEAR_WEIGHT = 3;

type SkillSignals = { phrases: PhraseTier; near: readonly NearPair[] };

const SIGNALS: Record<ArcSkillId, SkillSignals> = {
  /** Single creative artifacts: images, video, logo edits, one-off copy.
   *  This is what the live corpus is mostly made of. */
  [ARC_SKILL_IDS.approvalGatedDrafting]: {
    phrases: [
      [
        "headline options", "remove the background", "aspect ratio", "creative asset",
        "make me an image", "make me a video", "on its own line",
      ],
      ["image", "video", "logo", "photo", "mockup", "thumbnail", "upscale", "reframe", "resize", "headline"],
      ["asset", "creative", "render", "background", "crop"],
    ],
    near: [
      ["generate", "image"], ["generate", "video"], ["generate", "photo"],
      ["make", "image"], ["make", "video"], ["create", "image"], ["create", "video"],
      ["create", "asset"], ["make", "asset"], ["design", "asset"],
      ["add", "logo"], ["put", "logo"], ["remove", "logo"], ["take", "logo"],
      ["edit", "image"], ["edit", "photo"], ["change", "image"],
      ["write", "headline"], ["write", "headlines"],
    ],
  },
  /** Multi-channel campaign packages and the copy inside them. Routed here
   *  rather than to the generic drafting playbook because this is the one
   *  playbook carrying real campaign craft (sequence structure, one CTA per
   *  asset, channel constraints). */
  [ARC_SKILL_IDS.campaignPackageDrafting]: {
    phrases: [
      [
        "campaign package", "full package", "campaign brief", "email sequence",
        "follow up sequence", "nurture sequence", "landing page copy", "paid social",
        "ad copy", "sms draft", "email draft", "handoff note", "target audience",
        "considered audiences", "multi channel", "drip",
      ],
      ["campaign", "sequence", "newsletter", "outreach", "subject line", "call to action", "cta"],
      ["copy", "channel", "audience", "brand voice", "tone", "offer"],
    ],
    near: [
      ["draft", "campaign"], ["write", "campaign"], ["build", "campaign"],
      ["create", "campaign"], ["put", "campaign"], ["draft", "email"],
      ["write", "email"], ["draft", "copy"], ["write", "copy"], ["draft", "sms"],
      ["draft", "package"], ["write", "package"], ["draft", "sequence"],
      ["draft", "post"], ["write", "post"], ["draft", "ad"], ["write", "ad"],
    ],
  },
  [ARC_SKILL_IDS.opportunityDiscovery]: {
    phrases: [
      [
        "find leads", "find me leads", "find new leads", "new leads", "surface leads",
        "best opportunities", "top opportunities", "worth pursuing", "worth acting on",
        "who should we", "which customers", "who hasnt", "who has not",
        "build an audience", "build me an audience", "build a segment",
        "lead score", "rank the", "how did", "how are we doing",
        "what worked", "analyze results", "conversion rate", "storm",
      ],
      [
        "audience", "segment", "leads", "prospects", "pipeline", "opportunities",
        "performance", "results", "metrics", "roi", "open rate", "click rate",
        "rank", "prioritize", "inactive", "dormant",
      ],
      ["signals", "weather", "property", "revenue"],
    ],
    near: [
      ["find", "leads"], ["find", "opportunities"], ["build", "audience"],
      ["score", "leads"], ["rank", "opportunities"], ["analyze", "performance"],
    ],
  },
  [ARC_SKILL_IDS.companyResearch]: {
    phrases: [
      [
        "research", "look up", "tell me about", "what do we know about",
        "summarize", "summarise", "give me a summary", "persona brief",
        "whats pending", "what is pending", "waiting for approval", "needs approval",
        "needs my review", "local search", "competitor", "competitors",
        "who is", "background on", "status of",
      ],
      [
        "persona", "personas", "brief", "background", "context", "explain",
        "overview", "pending", "approval", "approvals", "recap", "catch me up",
      ],
      ["company", "market", "industry", "profile"],
    ],
    near: [["research", "company"], ["look", "competitor"], ["summarize", "campaign"]],
  },
  /** Deliberately narrow: authoring a skill is an explicit act, and a false
   *  positive hijacks an unrelated turn into a guided interview. Only
   *  unambiguous phrasings qualify. */
  [ARC_SKILL_IDS.skillAuthoring]: {
    phrases: [
      [
        "create a skill", "make a skill", "build a skill", "new skill",
        "add a skill", "install a skill", "import a skill", "skill md",
      ],
      [],
      [],
    ],
    near: [],
  },
};

/** Mode is a weak prior, not a decision. Operator wording always outweighs it:
 *  a ±1 nudge cannot lift a playbook over the margin on its own, and cannot
 *  sink one the words clearly picked. Isolated here so it is trivial to drop
 *  if the replay shows it earning nothing. */
const MODE_PRIOR: Record<string, Partial<Record<ArcSkillId, number>>> = {
  draft: { [ARC_SKILL_IDS.approvalGatedDrafting]: 1, [ARC_SKILL_IDS.campaignPackageDrafting]: 1 },
  ask: { [ARC_SKILL_IDS.approvalGatedDrafting]: -1, [ARC_SKILL_IDS.campaignPackageDrafting]: -1 },
  scan: { [ARC_SKILL_IDS.opportunityDiscovery]: 1 },
};

/**
 * Position bonus for the strong signal that leads the message.
 *
 * Without it, "draft a campaign for the storm damage leads" ties: drafting
 * scores on "draft a campaign", discovery on "storm" + "leads". Those are not
 * equal evidence — the leading imperative is the *ask*, the trailing noun
 * phrase is the *audience*. Operators write this way consistently.
 *
 * The comparison is relative, not a fixed prefix window: whichever playbook's
 * strong signal appears earliest takes the bonus, and only if it is alone in
 * first place. A fixed window fails on short messages, where every signal falls
 * inside it and the bonus cancels out.
 *
 * Withheld from fragments — in "summarize performance" there is no sentence to
 * position anything within, so leading is not evidence of anything.
 */
const LEAD_BONUS = 2;
const MIN_WORDS_FOR_LEAD_BONUS = 5;

/** Absolute floor: below this, the match is incidental vocabulary. */
const MIN_SCORE = 3;
/** Required lead over the runner-up. A 1-point lead is a coin flip dressed up
 *  as a decision — those turns are genuinely ambiguous and abstain. */
const MIN_MARGIN = 2;
/** Above this lead, the pick is unambiguous enough to report as high confidence. */
const HIGH_CONFIDENCE_MARGIN = 4;

export type ArcSkillScore = { id: ArcSkillId; score: number };

export type InferredArcSkill = {
  id: ArcSkillId;
  score: number;
  /** Lead over the runner-up. Surfaced so shadow-mode telemetry can retune
   *  MIN_MARGIN against real traffic instead of guesswork. */
  margin: number;
  confidence: "high" | "medium";
};

export type InferArcSkillInput = {
  body: string;
  mode?: string | null;
};

/** Lowercase, punctuation-to-space, space-padded so phrase tests match on word
 *  boundaries. Apostrophes are dropped rather than spaced, so "who hasn't"
 *  normalizes to "who hasnt" — which is why the signal lists spell it that way. */
function normalize(body: string): string {
  return ` ${body.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Character offset of the first in-order, within-gap occurrence of a pair, or
 *  -1. Returns an offset (not a word index) so it is directly comparable with
 *  `indexOf` results when deciding which signal leads. */
function findNear(words: string[], offsets: number[], [first, second]: NearPair): number {
  for (let i = 0; i < words.length; i += 1) {
    if (words[i] !== first) continue;
    const limit = Math.min(words.length, i + 1 + MAX_NEAR_GAP);
    for (let j = i + 1; j < limit; j += 1) {
      if (words[j] === second) return offsets[i]!;
    }
  }
  return -1;
}

/**
 * Every playbook's score for a turn, highest first. Exported for diagnostics
 * and shadow-mode replay — the decision itself is `inferArcSkill`.
 *
 * Repeated signals count once. Saying "draft" four times is emphasis, not four
 * independent pieces of evidence, and letting it compound would let a single
 * word clear the margin by itself.
 */
export function scoreArcSkills(input: InferArcSkillInput): ArcSkillScore[] {
  const normalized = normalize(input.body ?? "");
  const prior = MODE_PRIOR[(input.mode ?? "").toLowerCase()] ?? {};

  // Word list plus each word's offset in `normalized`, so proximity matches and
  // phrase matches can be compared on the same scale for the lead bonus.
  const words: string[] = [];
  const offsets: number[] = [];
  for (const match of normalized.matchAll(/[a-z0-9]+/g)) {
    words.push(match[0]);
    offsets.push(match.index);
  }

  const raw = (Object.keys(SIGNALS) as ArcSkillId[]).map((id) => {
    const { phrases, near } = SIGNALS[id];
    let score = 0;
    // Where this playbook's earliest strong signal starts, for the lead bonus.
    let firstStrongAt = Number.POSITIVE_INFINITY;

    phrases.forEach((tier, tierIndex) => {
      for (const phrase of tier) {
        const at = normalized.indexOf(` ${phrase} `);
        if (at === -1) continue;
        score += WEIGHTS[tierIndex]!;
        if (tierIndex === 0) firstStrongAt = Math.min(firstStrongAt, at);
      }
    });

    for (const pair of near) {
      const at = findNear(words, offsets, pair);
      if (at === -1) continue;
      score += NEAR_WEIGHT;
      firstStrongAt = Math.min(firstStrongAt, at);
    }

    return { id, score, firstStrongAt };
  });

  // Sole earliest strong signal wins the bonus; a tie means nobody led.
  const earliest = Math.min(...raw.map((entry) => entry.firstStrongAt));
  const leaders = raw.filter((entry) => entry.firstStrongAt === earliest);
  const leaderId =
    words.length >= MIN_WORDS_FOR_LEAD_BONUS && leaders.length === 1 && Number.isFinite(earliest)
      ? leaders[0]!.id
      : null;

  return raw
    .map(({ id, score }) => {
      if (id === leaderId && score > 0) score += LEAD_BONUS;
      // The prior only adjusts a playbook the words already engaged; it cannot
      // conjure a score from nothing.
      if (score > 0) score += prior[id] ?? 0;
      return { id, score };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * The routing decision, or `null` to run unskilled exactly as Arc does today.
 *
 * Abstains when: the body is empty, the operator already typed a slash command
 * (the explicit path owns that turn), no playbook clears MIN_SCORE, or the
 * leader's margin over the runner-up is too thin to call.
 */
export function inferArcSkill(input: InferArcSkillInput): InferredArcSkill | null {
  const body = (input.body ?? "").trim();
  // An explicit command is resolved upstream; never second-guess it here.
  if (!body || body.startsWith("/")) return null;

  const [leader, runnerUp] = scoreArcSkills({ ...input, body });
  if (!leader || leader.score < MIN_SCORE) return null;

  const margin = leader.score - (runnerUp?.score ?? 0);
  if (margin < MIN_MARGIN) return null;

  return {
    id: leader.id,
    score: leader.score,
    margin,
    confidence: margin >= HIGH_CONFIDENCE_MARGIN ? "high" : "medium",
  };
}
