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

/**
 * Display tone for a status, split deliberately down the middle.
 *
 * The SEMANTIC half — won, lost, and closed-but-neither — comes from the flags.
 * Those are the three a tenant can rename out from under us, and reading them
 * from `isWon`/`isLost`/`isTerminal` is what keeps a renamed "Retained" showing
 * as a win instead of falling through to grey.
 *
 * The IN-FLIGHT half stays a label heuristic. "Scheduled" and "In progress" are
 * both qualified-and-not-terminal, so the flags cannot tell them apart, and
 * deciding by flag alone would repaint every existing board the day this ships.
 * A workspace that never touches its stages keeps exactly the colours it has.
 *
 * `stage` is null for statuses that aren't pipeline stages at all — companies
 * and contacts have their own vocabulary — so the heuristic carries those alone.
 */
export type PipelineTone =
  | "won"
  | "lost"
  | "qualified"
  | "sched"
  | "review"
  | "new"
  | "active"
  | "dnc"
  | "inactive";

export function statusTone(status: string, stage: PipelineStage | null = null): PipelineTone {
  if (stage) {
    if (stage.isWon) return "won";
    if (stage.isLost) return "lost";
    // Terminal but neither is a filing action (archived, on hold). Grey, not red:
    // colouring it as a loss would read as an outcome the tenant didn't record.
    if (stage.isTerminal) return "inactive";
  }

  // Below this line is the pre-existing heuristic, unchanged and in its original
  // order. It is deliberately NOT "improved" while moving it: `validated` falls
  // all the way through to `inactive` today, and quietly fixing that here would
  // recolour a stage in every workspace that never asked for a change.
  const t = (status || "").toLowerCase();
  if (/do not contact|dnc|blocked|suppress/.test(t)) return "dnc";
  if (/lost|dead|cancel|churn/.test(t)) return "lost";
  if (/won|complete|closed.?won|paid/.test(t)) return "won";
  if (/qualified/.test(t)) return "qualified";
  if (/schedul|booked|dispatch/.test(t)) return "sched";
  if (/review|pending|needs|hold/.test(t)) return "review";
  if (/new|open|fresh|inbound|prospect/.test(t)) return "new";
  if (/active|live|engaged|in progress/.test(t)) return "active";
  return "inactive";
}

/** The four-value tone the CRM read-model renders record chrome with. */
export type StageAccent = "amber" | "green" | "red" | "blue";

/**
 * Same split as `statusTone`, against the read-model's four-value palette.
 *
 * Flags decide the outcome colours; the explicit lists below are the original
 * mapping, kept verbatim so every default stage lands on the colour it lands on
 * today. Note `isQualified` deliberately does NOT force green — "Scheduled" is
 * a qualified stage that reads blue, and honouring the flag here would repaint
 * it.
 */
export function statusAccent(status: string, stage: PipelineStage | null = null): StageAccent {
  if (stage) {
    if (stage.isWon) return "green";
    if (stage.isLost) return "red";
    // Out of play, no outcome recorded — the same red an archived record gets.
    if (stage.isTerminal) return "red";
  }

  if (["active", "validated", "qualified", "converted", "completed", "won", "paid"].includes(status)) return "green";
  if (["lost", "canceled", "written_off", "archived", "inactive", "do_not_contact"].includes(status)) return "red";
  if (["running", "in_progress", "scheduled"].includes(status)) return "blue";
  return "amber";
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

/* ------------------------------------------------------------------ *
 * Authoring
 *
 * Every edit is expressed as a transform over the WHOLE set, validated as a
 * whole, and only then handed to the persistence layer. That ordering is the
 * point: `validateStageSet` refuses a pipeline with no won stage, and a tenant
 * archiving their last one is exactly how that happens in practice. Editing one
 * row at a time and validating one row at a time would let it through.
 *
 * These return the FULL set including archived stages — that is what gets
 * written back — while validation only ever considers the active ones.
 * ------------------------------------------------------------------ */

export type StageSetEdit = { ok: true; stages: PipelineStage[] } | { ok: false; error: string };

export type StageDraft = {
  label: string;
  isTerminal?: boolean;
  isWon?: boolean;
  isLost?: boolean;
  isQualified?: boolean;
};

/**
 * Dense, gap-free ordering over the active stages, archived ones parked after.
 *
 * Renumbering on every edit keeps "move up" meaningful after a stage in the
 * middle is archived — otherwise sort orders drift apart and a later reorder
 * swaps two positions that aren't adjacent on screen.
 */
function renumber(stages: readonly PipelineStage[]): PipelineStage[] {
  const active = stages
    .filter((s) => s.active)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s, i) => ({ ...s, sortOrder: i }));
  const archived = stages
    .filter((s) => !s.active)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s, i) => ({ ...s, sortOrder: active.length + i }));
  return [...active, ...archived];
}

function settle(next: readonly PipelineStage[]): StageSetEdit {
  const ordered = renumber(next);
  const check = validateStageSet(ordered);
  if (!check.ok) return check;
  return { ok: true, stages: ordered };
}

/**
 * Add a stage, or revive an archived one that already owns the derived key.
 *
 * Reviving rather than inserting a second row matches the custom-fields layer
 * and the unique index, which spans archived rows — and more importantly, the
 * archived stage's key is still stored on every record that was sitting in it,
 * so bringing it back re-maps those records instead of stranding them.
 */
export function addStage(stages: readonly PipelineStage[], draft: StageDraft): StageSetEdit {
  const label = draft.label.trim();
  if (!label) return { ok: false, error: "Give the stage a name." };

  const key = derivePipelineStageKey(label);
  if (!key) return { ok: false, error: `"${label}" doesn't contain any letters or numbers to build a key from.` };

  const flags = {
    isTerminal: draft.isTerminal === true,
    isWon: draft.isWon === true,
    isLost: draft.isLost === true,
    isQualified: draft.isQualified === true,
  };

  const existing = stages.find((s) => s.key === key);
  if (existing?.active) {
    return { ok: false, error: `"${existing.label}" already uses that name.` };
  }
  if (existing) {
    return settle(
      stages.map((s) => (s.key === key ? { ...s, ...flags, label, active: true, sortOrder: s.sortOrder } : s)),
    );
  }

  const nextOrder = stages.filter((s) => s.active).length;
  return settle([...stages, { key, label, sortOrder: nextOrder, active: true, ...flags }]);
}

export type StagePatch = {
  label?: string;
  isTerminal?: boolean;
  isWon?: boolean;
  isLost?: boolean;
  isQualified?: boolean;
};

/**
 * Rename a stage, or change what it means.
 *
 * The machine `key` is immutable, exactly as it is for custom fields: it is the
 * value stored on every record and the one Arc and any export address the stage
 * by. Renaming the label is free and is the whole point of this feature —
 * "Qualified" becomes "Engaged" and every record follows, because none of them
 * ever stored the word.
 */
export function updateStage(
  stages: readonly PipelineStage[],
  key: string,
  patch: StagePatch,
): StageSetEdit {
  const target = stages.find((s) => s.key === key);
  if (!target) return { ok: false, error: "That stage no longer exists." };

  const label = patch.label === undefined ? target.label : patch.label.trim();
  if (!label) return { ok: false, error: "Give the stage a name." };

  return settle(
    stages.map((s) =>
      s.key === key
        ? {
            ...s,
            label,
            isTerminal: patch.isTerminal ?? s.isTerminal,
            isWon: patch.isWon ?? s.isWon,
            isLost: patch.isLost ?? s.isLost,
            isQualified: patch.isQualified ?? s.isQualified,
          }
        : s,
    ),
  );
}

/** Swap a stage with its neighbour in display order. */
export function moveStage(
  stages: readonly PipelineStage[],
  key: string,
  direction: "up" | "down",
): StageSetEdit {
  const active = orderedStages(stages);
  const index = active.findIndex((s) => s.key === key);
  if (index === -1) return { ok: false, error: "That stage no longer exists." };

  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= active.length) return { ok: true, stages: renumber(stages) };

  const reordered = active.slice();
  [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];

  const orderByKey = new Map(reordered.map((s, i) => [s.key, i]));
  return settle(stages.map((s) => (orderByKey.has(s.key) ? { ...s, sortOrder: orderByKey.get(s.key)! } : s)));
}

/**
 * Archive a stage.
 *
 * Refuses through `validateStageSet` when this would leave the pipeline without
 * a won or closing stage — the two cases that silently zero a tenant's own
 * revenue reporting. Records still sitting in the stage are the caller's problem
 * to move first; see `countRecordsInStage` in the persistence layer.
 */
export function archiveStage(stages: readonly PipelineStage[], key: string): StageSetEdit {
  const target = stages.find((s) => s.key === key);
  if (!target) return { ok: false, error: "That stage no longer exists." };
  if (!target.active) return { ok: true, stages: renumber(stages) };

  return settle(stages.map((s) => (s.key === key ? { ...s, active: false } : s)));
}

export function restoreStage(stages: readonly PipelineStage[], key: string): StageSetEdit {
  const target = stages.find((s) => s.key === key);
  if (!target) return { ok: false, error: "That stage no longer exists." };
  if (target.active) return { ok: true, stages: renumber(stages) };

  // Restored stages land at the end of the active list; the operator can move it.
  const nextOrder = stages.filter((s) => s.active).length;
  return settle(stages.map((s) => (s.key === key ? { ...s, active: true, sortOrder: nextOrder } : s)));
}
