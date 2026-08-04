import type { ArcActionCard, ArcMode } from "@/domain";

import { buildArcRunProfile, type ArcRunIntent } from "./run-profile";

export type ArcOutcomeBadge = {
  kind: "sources" | "memory" | "created" | "limitation";
  label: string;
};

export type ArcOutcomeView = {
  intent: ArcRunIntent;
  label: string;
  body: string;
  safetyLabel: string;
  nextAction: string;
  badges: ArcOutcomeBadge[];
};

const LIMITATION_PATTERN = /\b(uncertain|uncertainty|limitation|could not|couldn't|cannot|can't confirm|no slices|not enough data|incomplete data|moderate confidence)\b/i;

function plural(count: number, singular: string, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

/**
 * Convert a completed Arc reply into an intent-aware presentation model.
 *
 * `body` is the reply **verbatim** — this layer never rewrites, retitles, or
 * reorders what Arc said. It used to hoist a markdown heading out of the
 * response into a display headline; that both invented a title when the reply
 * had no heading and, because the match wasn't anchored to the start of the
 * document, could promote a mid-document `## Section` and delete it from the
 * section it belonged to. The answer is Arc's; only the evidence around it is
 * ours, and every badge here appears only when the reply actually has that
 * evidence to back it.
 */
export function buildArcOutcomeView(input: {
  request?: string | null;
  response: string;
  mode?: ArcMode;
  command?: string | null;
  sourceCount?: number;
  recallCount?: number;
  actions?: ArcActionCard[];
}) {
  const profile = buildArcRunProfile({
    request: input.request,
    mode: input.mode,
    command: input.command,
  });
  const actions = input.actions ?? [];
  const badges: ArcOutcomeBadge[] = [];
  const sourceCount = input.sourceCount ?? 0;
  const recallCount = input.recallCount ?? 0;
  const createdDraftCount = actions.filter((action) => action.kind === "draft").length;
  const unrecordedAction = profile.intent === "action" && createdDraftCount === 0;

  if (sourceCount > 0) badges.push({ kind: "sources", label: plural(sourceCount, "source") });
  if (recallCount > 0) badges.push({ kind: "memory", label: plural(recallCount, "memory", "memories") });
  if (createdDraftCount > 0) badges.push({ kind: "created", label: plural(createdDraftCount, "deliverable") });
  if (LIMITATION_PATTERN.test(input.response)) badges.push({ kind: "limitation", label: "Limitations noted" });

  if (unrecordedAction) {
    return {
      intent: profile.intent,
      label: profile.resultLabel,
      body: input.response,
      safetyLabel: "No changes recorded",
      nextAction: profile.nextAction,
      badges,
    } satisfies ArcOutcomeView;
  }

  const createdOutput = createdDraftCount > 0;
  return {
    intent: profile.intent,
    label: createdOutput ? "Created" : profile.resultLabel,
    body: input.response,
    safetyLabel: input.mode === "ask"
      ? "Read only"
      : profile.intent === "create" || createdOutput
        ? "Nothing sent"
        : "No changes recorded",
    nextAction: profile.nextAction,
    badges,
  } satisfies ArcOutcomeView;
}
