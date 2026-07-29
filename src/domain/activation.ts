/**
 * First-run activation logic. Pure and deterministic — computes the setup checklist
 * a new workspace owner sees from a set of signals gathered by the lib layer.
 *
 * Step order is the product argument, not decoration. A new workspace is created
 * with default media folders and an industry persona pack and NOTHING else: no
 * contacts, no companies, no campaigns, no opportunities. So the pitch — "Arc
 * watches your records and finds opportunities" — has nothing to watch on day
 * one, and the most convincing part of the product is invisible exactly when a
 * new owner is deciding whether it works.
 *
 * `records` therefore comes first and is the core step: every other surface in
 * the app is downstream of having records to work from. Brand is second because
 * it's what makes drafts sound like the customer rather than generic. Media and
 * team are genuinely optional encouragements.
 */

export type ActivationSignals = {
  /** Any companies or contacts in the workspace — the prerequisite for everything. */
  hasRecords: boolean;
  brandCaptured: boolean;
  dismissed: boolean;
  hasMedia: boolean;
  hasCampaign: boolean;
  hasTeammate: boolean;
};

export type ActivationStepKey = "records" | "brand" | "campaign" | "media" | "team";

export type ActivationStep = {
  key: ActivationStepKey;
  done: boolean;
  /**
   * Whether skipping this leaves the product unable to demonstrate itself.
   * Only `records` qualifies — without it Arc has nothing to scan, so every
   * other screen stays empty no matter what else the owner does.
   */
  blocking: boolean;
};

export type ActivationChecklist = {
  steps: ActivationStep[];
  /** True once the workspace can actually exercise the product loop. */
  coreDone: boolean;
  showChecklist: boolean;
  /** The next thing worth doing, or null when everything is done. */
  nextStep: ActivationStepKey | null;
};

export function buildActivationChecklist(signals: ActivationSignals): ActivationChecklist {
  const steps: ActivationStep[] = [
    { key: "records", done: signals.hasRecords, blocking: true },
    { key: "brand", done: signals.brandCaptured, blocking: false },
    { key: "campaign", done: signals.hasCampaign, blocking: false },
    { key: "media", done: signals.hasMedia, blocking: false },
    { key: "team", done: signals.hasTeammate, blocking: false },
  ];

  // Core is records, not brand: a workspace with a beautifully captured brand and
  // no records still shows an empty app everywhere, which is the confusion this
  // checklist exists to prevent.
  const coreDone = signals.hasRecords;
  const allDone = steps.every((step) => step.done);
  const showChecklist = !signals.dismissed && !allDone;
  const nextStep = steps.find((step) => !step.done)?.key ?? null;

  return { steps, coreDone, showChecklist, nextStep };
}
