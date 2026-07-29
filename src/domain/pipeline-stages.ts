/**
 * Per-tenant pipeline stages (BSR-495).
 *
 * `lead_status` / `job_status` / `outcome_status` are Postgres enums, so a firm
 * whose pipeline is Intake → Conflicts check → Engaged → Closed cannot express
 * it: the database rejects the value. This module defines what a stage IS, so
 * the enum can become per-org data without the app losing the meanings it
 * currently reads out of the literal strings.
 *
 * THE POINT OF THIS FILE. Roughly 26 files test `status === "won"` and 19 test
 * `"qualified"`. If a tenant renames "Won" to "Retained", every one of those
 * comparisons silently goes false and their revenue reporting quietly zeroes —
 * no error, just wrong numbers. So a stage carries SEMANTIC FLAGS (`isWon`,
 * `isLost`, `isTerminal`, `isQualified`) and callers ask the stage what it
 * means rather than comparing its name.
 *
 * Only the tenant's SALES PROCESS lives here. `approval_status`,
 * `agent_task_status`, `campaign_status` and friends are app machinery — the
 * code branches on them, and making them configurable would let a tenant break
 * the approval gate. The rule: per-org if it describes the tenant's process,
 * never if the code branches on it.
 */

export const PIPELINE_OBJECT_KEYS = ["leads", "jobs", "outcomes"] as const;

export type PipelineObjectKey = (typeof PIPELINE_OBJECT_KEYS)[number];

export function isPipelineObjectKey(value: unknown): value is PipelineObjectKey {
  return typeof value === "string" && (PIPELINE_OBJECT_KEYS as readonly string[]).includes(value);
}

export type PipelineStage = {
  key: string;
  label: string;
  sortOrder: number;
  /** No further movement expected — the record has left the pipeline. */
  isTerminal: boolean;
  /** A terminal stage that counts as revenue won. Drives conversion + revenue reporting. */
  isWon: boolean;
  /** A terminal stage that counts as lost. Terminal-but-neither is neutral (e.g. archived). */
  isLost: boolean;
  /** Past initial triage — the denominator for qualification-rate style metrics. */
  isQualified: boolean;
  active: boolean;
};

const stage = (
  key: string,
  label: string,
  sortOrder: number,
  flags: Partial<Pick<PipelineStage, "isTerminal" | "isWon" | "isLost" | "isQualified">> = {},
): PipelineStage => ({
  key,
  label,
  sortOrder,
  isTerminal: flags.isTerminal ?? false,
  isWon: flags.isWon ?? false,
  isLost: flags.isLost ?? false,
  isQualified: flags.isQualified ?? false,
  active: true,
});

/**
 * The stages every existing workspace already has, with the meanings the code
 * currently infers from the literal strings made explicit.
 *
 * These are seeded verbatim for existing orgs, so day one behaviour is
 * unchanged — a tenant sees exactly what they see today until they edit it.
 * They also remain the offline/demo fallback, the same role
 * `OFFICIAL_PERSONA_MAPPINGS` plays after the persona taxonomy went per-org.
 */
export const DEFAULT_PIPELINE_STAGES: Record<PipelineObjectKey, readonly PipelineStage[]> = {
  leads: [
    stage("new", "New", 0),
    stage("validated", "Validated", 1),
    stage("needs_review", "Needs review", 2),
    stage("qualified", "Qualified", 3, { isQualified: true }),
    stage("converted", "Converted", 4, { isQualified: true, isTerminal: true, isWon: true }),
    stage("lost", "Lost", 5, { isTerminal: true, isLost: true }),
    // Terminal but neither won nor lost: archiving is a filing action, not an
    // outcome, and counting it either way would distort conversion rate.
    stage("archived", "Archived", 6, { isTerminal: true }),
  ],
  jobs: [
    stage("pending", "Pending", 0),
    stage("scheduled", "Scheduled", 1, { isQualified: true }),
    stage("in_progress", "In progress", 2, { isQualified: true }),
    stage("completed", "Completed", 3, { isQualified: true, isTerminal: true, isWon: true }),
    stage("canceled", "Canceled", 4, { isTerminal: true, isLost: true }),
  ],
  outcomes: [
    stage("pending", "Pending", 0),
    stage("won", "Won", 1, { isQualified: true, isTerminal: true, isWon: true }),
    stage("lost", "Lost", 2, { isTerminal: true, isLost: true }),
    // Paid is won money that has actually landed — still won, not a separate outcome.
    stage("paid", "Paid", 3, { isQualified: true, isTerminal: true, isWon: true }),
    stage("written_off", "Written off", 4, { isTerminal: true, isLost: true }),
  ],
};

/** Machine key from an operator-typed label ("Conflicts check" -> "conflicts_check"). */
export function derivePipelineStageKey(label: unknown): string {
  if (typeof label !== "string") return "";
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "";
  const withLetter = /^[a-z]/.test(slug) ? slug : `s_${slug}`;
  return withLetter.slice(0, 63).replace(/_+$/g, "");
}

/**
 * The stage a record's stored status refers to, or null when the workspace has
 * no such stage.
 *
 * Null is meaningful and must not be coerced to a default: a status that no
 * longer maps is a record the tenant needs to see and fix, not one to quietly
 * relabel as "New".
 */
export function findStage(
  stages: readonly PipelineStage[],
  status: string | null | undefined,
): PipelineStage | null {
  const key = typeof status === "string" ? status.trim() : "";
  if (!key) return null;
  return stages.find((s) => s.key === key) ?? null;
}

/**
 * Whether a stored status counts as won — the replacement for `=== "won"`.
 *
 * Unknown statuses are NOT won. Guessing here would invent revenue, which is
 * the one direction this must never fail.
 */
export function isWonStatus(stages: readonly PipelineStage[], status: string | null | undefined): boolean {
  return findStage(stages, status)?.isWon === true;
}

export function isLostStatus(stages: readonly PipelineStage[], status: string | null | undefined): boolean {
  return findStage(stages, status)?.isLost === true;
}

export function isTerminalStatus(stages: readonly PipelineStage[], status: string | null | undefined): boolean {
  return findStage(stages, status)?.isTerminal === true;
}

export function isQualifiedStatus(stages: readonly PipelineStage[], status: string | null | undefined): boolean {
  return findStage(stages, status)?.isQualified === true;
}

/** Active stages in display order — what a picker or board column list renders. */
export function orderedStages(stages: readonly PipelineStage[]): PipelineStage[] {
  return stages
    .filter((s) => s.active)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

export type StageValidation = { ok: true; stages: PipelineStage[] } | { ok: false; error: string };

/**
 * Validate a full stage set for one object.
 *
 * Checked as a SET, not per stage: a pipeline with two "won" stages or no
 * terminal stage at all is individually plausible and collectively broken.
 */
export function validateStageSet(input: readonly PipelineStage[]): StageValidation {
  const stages = input.filter((s) => s.active);
  if (stages.length === 0) return { ok: false, error: "A pipeline needs at least one stage." };

  const seen = new Set<string>();
  for (const s of stages) {
    if (!s.key || !/^[a-z][a-z0-9_]{0,62}$/.test(s.key)) {
      return { ok: false, error: `"${s.label || s.key}" needs a valid key.` };
    }
    if (seen.has(s.key)) return { ok: false, error: `Duplicate stage "${s.key}".` };
    seen.add(s.key);
    if (!s.label.trim()) return { ok: false, error: `Stage "${s.key}" needs a name.` };
    if (s.isWon && s.isLost) {
      return { ok: false, error: `"${s.label}" cannot be both won and lost.` };
    }
    if ((s.isWon || s.isLost) && !s.isTerminal) {
      // Won/lost are outcomes, and an outcome that isn't terminal means a record
      // can be counted as revenue and then move on, double-counting it.
      return { ok: false, error: `"${s.label}" is an outcome, so it must be a terminal stage.` };
    }
  }

  if (!stages.some((s) => s.isTerminal)) {
    return { ok: false, error: "A pipeline needs at least one closing stage." };
  }
  if (!stages.some((s) => s.isWon)) {
    // Without one, every conversion and revenue metric silently reads zero.
    return { ok: false, error: "Mark one closing stage as won, or revenue reporting has nothing to count." };
  }

  return { ok: true, stages };
}
