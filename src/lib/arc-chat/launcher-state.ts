import { WORK_STATE_LABEL } from "@/domain";

import type { ArcWaitingOpp } from "./waiting-opps";

export type ArcLauncherMode = "urgent" | "review" | "opportunity" | "quiet";

export type ArcLauncherRecommendation = {
  mode: ArcLauncherMode;
  eyebrow: string;
  title: string;
  description: string;
  urgency: ArcWaitingOpp["urgency"];
  prompt?: string;
  href?: string;
};

const DEFAULT_SIGNAL_PROMPT = "What new signals or opportunities should I know about today?";

/** Picks one clear next action from live workspace state. The launcher changes
 * with the operator's day instead of presenting the same three equal choices. */
export function buildArcLauncherRecommendation(waiting?: {
  approvals: number;
  opportunities: number;
  items?: ArcWaitingOpp[];
} | null): ArcLauncherRecommendation {
  const urgent = waiting?.items?.find((item) => item.urgency === "high");
  if (urgent) {
    return {
      mode: "urgent",
      eyebrow: "Time-sensitive opportunity",
      title: urgent.title,
      description: urgent.prompt,
      urgency: "high",
      prompt: urgent.prompt,
    };
  }

  if ((waiting?.approvals ?? 0) >= 3) {
    const count = waiting?.approvals ?? 0;
    return {
      mode: "review",
      eyebrow: "Clear the review queue",
      title: `${count} items are waiting for your decision`,
      description: "Review finished work before starting another run.",
      urgency: "medium",
      href: "/campaigns",
    };
  }

  const opportunity = waiting?.items?.[0];
  if (opportunity) {
    return {
      mode: "opportunity",
      eyebrow: "Recommended next",
      title: opportunity.title,
      description: opportunity.prompt,
      urgency: opportunity.urgency,
      prompt: opportunity.prompt,
    };
  }

  if ((waiting?.approvals ?? 0) > 0) {
    const count = waiting?.approvals ?? 0;
    return {
      mode: "review",
      // Was "Ready for review" — a fifth name for the state the card below it
      // already calls "Needs you" (BSR-656).
      eyebrow: WORK_STATE_LABEL.needs_you,
      title: `${count} ${count === 1 ? "item needs" : "items need"} your decision`,
      description: "Open the review workspace to approve, revise, or decline it.",
      urgency: "medium",
      href: "/campaigns",
    };
  }

  if ((waiting?.opportunities ?? 0) > 0) {
    return {
      mode: "opportunity",
      eyebrow: "Explore today’s signals",
      title: `${waiting?.opportunities ?? 0} opportunities are ready to investigate`,
      description: "Ask Arc to rank the strongest signals and explain why they matter.",
      urgency: "medium",
      prompt: DEFAULT_SIGNAL_PROMPT,
    };
  }

  return {
    mode: "quiet",
    eyebrow: "Start with a workspace scan",
    title: "See what changed since your last visit",
    description: "Arc can check your workspace and surface the few things worth acting on.",
    urgency: "low",
    prompt: DEFAULT_SIGNAL_PROMPT,
  };
}
