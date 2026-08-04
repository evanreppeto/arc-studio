import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ArcClient } from "./arc-client";
import { buildQueryOptions, inferenceForCritic } from "./inference";
import { brainReadTools } from "./tools/brain";
import { intelligenceTools } from "./tools/intelligence";
import { libraryReadTools } from "./tools/library";
import { performanceReadTools } from "./tools/performance";
import { textResult, type StepFn } from "./tools/helpers";
import type { DraftForReview } from "./types";

/**
 * The draft critic — an independent, read-only reviewer of copy Arc just wrote.
 *
 * Why this exists: the deterministic copy screen (app-side, in
 * promoteAssetToCampaign) can only prove copy is not *known*-bad against the
 * org's banned-phrase list. It cannot see an invented statistic, a guarantee the
 * business doesn't offer, or a claim that reads clean and is simply untrue. That
 * needs a reader.
 *
 * Why it's a separate pass and NOT an SDK subagent: `agents` registers a
 * subagent the model invokes via the Task tool — meaning the drafting model
 * would choose whether to be reviewed. A gate the gated party can skip is not a
 * gate. The caller runs this in code, so it isn't optional.
 *
 * Why it gets its own query(): independence is the point. The critic never sees
 * why the drafting turn thought a claim was fine — only the copy and the
 * workspace evidence. The context that wrote the sentence is the worst possible
 * judge of whether it made the number up.
 *
 * Advisory only: the critic annotates, raises risk, and recommends. It never
 * approves, declines, blocks, or unlocks. The human still decides.
 */

export type CriticVerdict = "grounded" | "unsupported" | "fabricated";

export type CriticFix = {
  target: string;
  label: string;
  kind: "text" | "phone" | "url" | "date" | "address";
};

export type CriticFinding = {
  claim: string;
  verdict: CriticVerdict;
  note: string;
  /** Set only when the whole problem is one missing value — see submit_review. */
  fix?: CriticFix | null;
};

export type CriticReview = {
  findings: CriticFinding[];
  recommendation: string;
  rationale: string;
  suggestedEdits: string;
};

const CRITIC_SYSTEM_PROMPT = `You are a claims reviewer for an approval-gated marketing platform. You did NOT write the copy in front of you — someone else did, and your job is to find what's wrong with it before a human is asked to approve it.

YOUR ONE QUESTION: for every factual claim, statistic, offer, guarantee, timeframe, credential, and proof point in this draft — can THIS BUSINESS substantiate it from its own evidence?

That is not the same as "is this plausible" or "is this true in the world". A claim can be perfectly reasonable and still be one this business has no basis to make. You are checking substantiation, not plausibility. You have no web access on purpose: outside sources cannot substantiate a claim about this business.

HOW TO WORK:
1. Read the draft and list every checkable claim. Marketing adjectives ("fast", "trusted") are not claims. Numbers, guarantees, timeframes, outcomes, credentials, and comparisons are.
2. For each, go looking for the evidence with your read tools — the brain (facts and proof points), brand documents (voice, rules, disallowed claims), performance data (real numbers), and the media library. query_brain's search matches a node's title, body AND summary, so search for the substance of a claim ("arrival time", "certified", the specific number). One narrow search returning nothing is not proof the evidence is absent — try the claim's key terms, and list a whole kind (e.g. every proof_point) to read the full set before you rule a claim unsupported.
3. Assign a verdict:
   - grounded — you found the specific evidence. Name it in your note.
   - unsupported — plausible, but you could not find evidence for it.
   - fabricated — it contradicts evidence you DID find, or it promises an outcome outside the business's control.
4. TRY TO REFUTE, don't try to confirm. Go looking for the reason each claim is wrong. If you cannot find evidence, the verdict is "unsupported" — the burden is on the draft, not on you. Defaulting to "grounded" because a claim sounds right is the exact failure you exist to prevent.
5. Call submit_review exactly once with every claim you checked.

RECOMMENDATION: "approve" only when every checkable claim is grounded. "request revision" when anything is unsupported or fabricated. "decline" when the draft's central premise is fabricated and a rewrite wouldn't save it.

WHO READS THIS: the owner of the business, or whoever they trust with marketing. Not an engineer, and never you. They are deciding in seconds whether to ship this draft, and everything you write lands on a card in front of that decision.

So write it the way you would say it to them:
- No internal identifiers. No record ids, learning ids, node keys, or UUIDs. If a proof point matters, name it the way a person would ("the IICRC certification document"), not by its key.
- No tool names and no account of your own searching. "Searches for 'reply' and 'callback' returned nothing" is you describing your process; "nothing in the workspace describes a call-back workflow" is the finding. Only ever write the second.
- No column or field names. Say "no response-time commitment is recorded", not "sla_minutes is null".
- Plain sentences. If a claim is fine, say nothing about it — a grounded claim is the absence of a finding, not a paragraph confirming it.

LENGTH IS PART OF THE JOB. A reviewer who has to read 300 words to find two problems will stop reading, and then your review protects nobody. Every field below has a budget. Stay inside it.

Be specific and short. "The 60-minute response time is not in any proof point; performance shows a 3.2h median" beats "this may be inaccurate".

WHEN THE PROBLEM IS ONE MISSING VALUE, ASK FOR IT. Some findings are judgement — a claim overstates what the evidence supports, and only a person rewriting the sentence can settle it. Others are a blank: the copy says "Call [24/7 line]" and the only thing wrong is that nobody has put the number in. For that second kind, attach a "fix" to the finding naming the exact text to replace and what to ask for, and the reviewer gets a box to type it into instead of a paragraph telling them to go and do it themselves.

Only attach a fix when ALL of these hold, and leave it off otherwise — a fix that cannot be applied by typing one value into a box is worse than no fix at all:
- the whole problem goes away once one value is supplied;
- that value replaces a specific, literal run of text you can copy out of the draft character for character;
- you are not guessing what the value should be. You are not filling it in; you are asking.

"target" is that literal text and nothing more — "[24/7 line]", not the sentence around it. If the placeholder appears more than once, every copy is replaced, so name the placeholder rather than one occurrence of it.

You are ADVISORY. You never approve, decline, send, or unlock anything — you tell the human what you found. Do not comment on style, tone, or formatting unless it creates a factual or compliance risk.`;

/** The critic's read-only surface: workspace evidence only.
 *
 *  research_web is deliberately excluded. The critic verifies what THIS business
 *  can substantiate, and a web search can happily "confirm" a claim the business
 *  itself has no basis to make — which would turn the reviewer into a rubber stamp. */
const CRITIC_READ_TOOLS = new Set([
  "query_brain",
  "list_brand_documents",
  "read_brand_document",
  "read_performance",
  "list_media",
  "read_persona_intelligence",
]);

function submitReviewTool(collect: (review: CriticReview) => void) {
  return tool(
    "submit_review",
    "Record your review. Call this exactly once, at the end, with every claim you checked.",
    {
      findings: z
        .array(
          z.object({
            claim: z.string().describe("The exact sentence or phrase from the draft that makes the claim."),
            verdict: z
              .enum(["grounded", "unsupported", "fabricated"])
              .describe("grounded = you found the evidence; unsupported = you could not; fabricated = it contradicts evidence."),
            fix: z
              .object({
                target: z
                  .string()
                  .describe(
                    "The literal text in the draft to replace, copied out character for character — \"[24/7 line]\", not the sentence containing it. Every occurrence is replaced.",
                  ),
                label: z
                  .string()
                  .describe("What to ask the operator for, in their words: \"The number to call\". Under 6 words; it labels an input box."),
                kind: z
                  .enum(["text", "phone", "url", "date", "address"])
                  .describe("What sort of value this is. Chooses the keyboard on a phone; never used as validation."),
              })
              .optional()
              .describe(
                "ONLY when the entire problem is one missing value that replaces a literal run of text — a placeholder phone number, a missing address or date. Omit for anything needing judgement or a rewrite: a fix the operator cannot complete by typing one value is worse than none.",
              ),
            note: z
              .string()
              .describe(
                "Why, in one or two plain sentences, under 40 words. THE FIRST SENTENCE IS THE ONLY ONE SHOWN by default — the reviewer sees it on a single line beside the quote, and expands for the rest. So the first sentence states the problem; anything else is detail. No tool names, no record ids, no account of what you searched.",
              ),
          }),
        )
        .describe("Every checkable claim in the draft. Empty only if the draft makes no factual claims at all."),
      recommendation: z
        .enum(["approve", "request revision", "decline"])
        .describe("approve only when every claim is grounded."),
      rationale: z
        .string()
        .describe(
          "Why you landed where you did, for the business owner approving this. Under 60 words, plain sentences, no identifiers or tool names. It sits behind a fold labelled 'Why Arc says this' — the findings above it already carry the specifics, so do not repeat them here.",
        ),
      suggested_edits: z
        .string()
        .optional()
        .describe(
          "The concrete changes that would make this approvable, as a numbered list — '1) … 2) …' — because each one renders as its own row for the reviewer to work through. One line each, under 25 words. Say what to change, not why; the finding already said why.",
        ),
    },
    async (args) => {
      collect({
        findings: args.findings.map((f) => ({ ...f, fix: f.fix ?? null })),
        recommendation: args.recommendation,
        rationale: args.rationale,
        suggestedEdits: args.suggested_edits ?? "",
      });
      return textResult("Review recorded.");
    },
  );
}

function criticTools(client: ArcClient, step: StepFn, collect: (review: CriticReview) => void) {
  const readOnly = [
    ...brainReadTools(client, step),
    ...intelligenceTools(client, step),
    ...performanceReadTools(client, step),
    ...libraryReadTools(client, step),
  ].filter((t) => CRITIC_READ_TOOLS.has(t.name));
  return [...readOnly, submitReviewTool(collect)];
}

function criticPrompt(draft: DraftForReview, businessName: string): string {
  return [
    `Business: ${businessName}`,
    `Draft asset type: ${draft.assetType}`,
    `Draft title: ${draft.title}`,
    "",
    "Draft copy to review:",
    "---",
    draft.body,
    "---",
    "",
    "Check every claim in the copy above against this workspace's evidence, then call submit_review.",
  ].join("\n");
}

/**
 * Review one draft. Returns the critic's verdict, or null when it produced none
 * (no claims, an empty draft, or a run that failed) — the caller treats null as
 * "not reviewed", never as "approved".
 */
export async function reviewDraft(
  draft: DraftForReview,
  client: ArcClient,
  step: StepFn,
  businessName: string,
): Promise<CriticReview | null> {
  if (!draft.body.trim()) return null;

  let review: CriticReview | null = null;
  const tools = criticTools(client, step, (r) => {
    review = r;
  });
  const inference = inferenceForCritic();

  await step(`Reviewing claims in "${draft.title}"`, "running");
  try {
    for await (const _message of query({
      prompt: criticPrompt(draft, businessName),
      options: buildQueryOptions({
        inference,
        systemPrompt: CRITIC_SYSTEM_PROMPT,
        mcpServers: { critic: createSdkMcpServer({ name: "critic", version: "1.0.0", tools }) },
        allowedTools: tools.map((t) => `mcp__critic__${t.name}`),
      }),
    })) {
      // The verdict arrives through submit_review, not the reply text — the loop
      // only needs to run to completion.
      void _message;
    }
  } catch (error) {
    // The spawned claude CLI can exit non-zero even after the model has already
    // called submit_review (it prints benign notices to stderr, and the run can
    // end on a terminal condition after the tool result landed). The verdict we
    // collected is still the model's real answer, so losing it here would throw
    // away a completed review over an exit code. Only rethrow if we got nothing.
    if (!review) throw error;
    console.warn(`[arc-runner] critic for "${draft.title}" errored after submitting its review:`, error);
  } finally {
    await step(`Reviewing claims in "${draft.title}"`, "done");
  }

  return review;
}

/** Map the critic's findings onto the approval queue's risk vocabulary.
 *
 *  `blocked` is deliberately NOT reachable here: it means "contains a banned
 *  phrase", which the deterministic screen proves with certainty. The critic's
 *  judgment is probabilistic, so its worst verdict is `high`. `low` is only
 *  reachable here — it means a reviewer actually grounded every claim, which a
 *  phrase match can never establish. */
export function riskFromFindings(findings: CriticFinding[]): "low" | "medium" | "high" {
  if (findings.some((f) => f.verdict === "fabricated")) return "high";
  if (findings.some((f) => f.verdict === "unsupported")) return "medium";
  return "low";
}

/** The problem types to surface as risk flags on the approval card. */
export function riskFlagsFromFindings(findings: CriticFinding[]): string[] {
  const flags = new Set<string>();
  for (const finding of findings) {
    if (finding.verdict === "fabricated") flags.add("claim_risk");
    if (finding.verdict === "unsupported") flags.add("unsupported_claim");
  }
  return [...flags];
}

/**
 * Review one draft and persist the result. Best-effort by contract: a critic
 * failure must never break the drafting turn that produced the draft. The asset
 * is already pending_approval + dispatch_locked either way, so the human gate
 * holds whether or not the critique lands.
 */
export async function reviewAndRecordDraft(
  draft: DraftForReview,
  client: ArcClient,
  step: StepFn,
  businessName: string,
): Promise<void> {
  try {
    const review = await reviewDraft(draft, client, step, businessName);
    if (!review) return;
    await client.apiPost("/api/v1/arc/drafts/review", {
      asset_id: draft.assetId,
      risk_level: riskFromFindings(review.findings),
      recommendation: review.recommendation,
      rationale: review.rationale,
      risk_flags: riskFlagsFromFindings(review.findings),
      suggested_edits: review.suggestedEdits,
      findings: review.findings.map((f) => ({
        claim: f.claim,
        verdict: f.verdict,
        note: f.note,
        fix: f.fix ?? null,
      })),
    });
  } catch (error) {
    console.error(`[arc-runner] draft critic failed for asset ${draft.assetId}:`, error);
  }
}

/** Review every draft a turn produced, concurrently — one critic per asset, each
 *  with its own context. A critic handed 7 assets degrades on the later ones for
 *  the same reason the drafting agent does. */
export async function reviewTurnDrafts(
  drafts: DraftForReview[],
  client: ArcClient,
  step: StepFn,
  businessName: string,
): Promise<void> {
  if (drafts.length === 0) return;
  await Promise.all(drafts.map((draft) => reviewAndRecordDraft(draft, client, step, businessName)));
}
