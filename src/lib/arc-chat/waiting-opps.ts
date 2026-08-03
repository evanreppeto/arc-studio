import { type OpportunityRecord } from "@/lib/opportunities/read-model";

/** A single waiting opportunity surfaced in Arc's launcher: what it is, how
 *  urgent, and the prompt clicking it drops into the composer so Arc acts on it. */
export type ArcWaitingOpp = {
  id: string;
  title: string;
  urgency: "low" | "medium" | "high";
  /** Ready-to-send prompt — the opportunity's own arcPrompt when it has one. */
  prompt: string;
};

const URGENCY_RANK: Record<ArcWaitingOpp["urgency"], number> = { high: 3, medium: 2, low: 1 };

export function promptForOpportunity(opp: OpportunityRecord): string {
  // Next-iteration opportunities carry a ready-to-send draft prompt; use it verbatim.
  const arcPrompt = opp.evidence?.arcPrompt;
  if (typeof arcPrompt === "string" && arcPrompt.trim()) return arcPrompt.trim();
  // Everything else: ask Arc to act on the surfaced signal, keeping it approval-safe.
  return `Help me act on this opportunity: “${opp.title}”. What should we draft? Keep it a draft for my approval.`;
}

/**
 * Pure: the top waiting opportunities for Arc's launcher, most-urgent first (then
 * highest confidence), capped at `limit`. Each becomes a tappable nudge that
 * prefills the composer — so opening Arc greets the operator with the work that's
 * actually waiting (e.g. "Spring Storm Prep is converting — draft the next
 * iteration") instead of a bare count.
 */
export function buildArcWaitingOpportunities(opps: OpportunityRecord[], limit = 3): ArcWaitingOpp[] {
  return [...opps]
    .sort((a, b) => URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency] || b.confidence - a.confidence)
    .slice(0, limit)
    .map((opp) => ({ id: opp.id, title: opp.title, urgency: opp.urgency, prompt: promptForOpportunity(opp) }));
}
