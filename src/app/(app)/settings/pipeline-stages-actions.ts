"use server";

import { revalidatePath } from "next/cache";

import {
  addStage,
  archiveStage,
  findStage,
  isPipelineObjectKey,
  moveStage,
  restoreStage,
  updateStage,
  type PipelineObjectKey,
  type StageSetEdit,
} from "@/domain";
import { getCustomObjectByKey } from "@/lib/custom-objects/definitions";
import { requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";
import {
  countRecordsInStage,
  listStageSet,
  moveRecordsToStage,
  saveStageSet,
} from "@/lib/pipeline-stages/definitions";

import type { SettingsWriteResult } from "./actions";

/**
 * A tenant's pipeline is the shape of its own sales process: renaming a stage
 * changes every board column, filter and picker, and archiving one can silently
 * zero its revenue reporting. So these are requireOperator()-gated like the
 * other structural settings writes, and org-scoped from the session rather than
 * from the request.
 */
/**
 * Is this a pipeline the caller may edit?
 *
 * The three built-ins always are. A tenant-defined record type is too, once its
 * org has defined it — validity is per-workspace, so it cannot come from a
 * constant. Without this the settings panel listed a custom type's pipeline and
 * then refused every write against it: a screen that reads correctly and does
 * nothing.
 */
async function editablePipeline(orgId: string, objectKey: string): Promise<boolean> {
  if (isPipelineObjectKey(objectKey)) return true;
  const object = await getCustomObjectByKey(orgId, objectKey).catch(() => null);
  return object !== null;
}

const NOT_A_PIPELINE = "Pick which pipeline this stage belongs to.";

async function operatorOrg(): Promise<{ orgId: string } | { error: string }> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) {
    return { error: "Pipeline stages need a configured database." };
  }
  const ctx = await getCurrentWorkspaceContext().catch(() => null);
  if (!ctx?.orgId) {
    // Refuse rather than guess a tenant — writing one workspace's pipeline into
    // another is exactly the failure the org-scoping work closed.
    return { error: "Could not resolve your workspace." };
  }
  return { orgId: ctx.orgId };
}

function revalidateStageSurfaces(): void {
  revalidatePath("/settings");
  revalidatePath("/crm");
  revalidatePath("/analytics");
}

/**
 * Load the set, apply a domain transform, persist the result.
 *
 * Every mutation goes through here so validation always sees the WHOLE set.
 * That is what catches the case a per-row edit cannot: archiving the tenant's
 * last won stage is a perfectly valid edit to one row and a broken pipeline.
 */
async function editStages(
  objectKey: string,
  transform: (stages: Awaited<ReturnType<typeof listStageSet>>) => StageSetEdit,
  message: string,
): Promise<SettingsWriteResult> {
  const scope = await operatorOrg();
  if ("error" in scope) return { ok: false, error: scope.error };

  if (!(await editablePipeline(scope.orgId, objectKey))) {
    return { ok: false, error: NOT_A_PIPELINE };
  }

  let current;
  try {
    current = await listStageSet(scope.orgId, objectKey);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not load your pipeline." };
  }

  const next = transform(current);
  // The validation errors are written for an operator to read and are the
  // guardrails themselves — surfaced verbatim rather than replaced with a
  // generic failure.
  if (!next.ok) return { ok: false, error: next.error };

  const saved = await saveStageSet(scope.orgId, objectKey, next.stages);
  if (!saved.ok) return { ok: false, error: saved.error };

  revalidateStageSurfaces();
  return { ok: true, persisted: true, message };
}

export async function createPipelineStage(input: {
  objectKey: string;
  label: string;
  isTerminal?: boolean;
  isWon?: boolean;
  isLost?: boolean;
  isQualified?: boolean;
}): Promise<SettingsWriteResult> {
  return editStages(
    input.objectKey,
    (stages) =>
      addStage(stages, {
        label: input.label,
        isTerminal: input.isTerminal,
        isWon: input.isWon,
        isLost: input.isLost,
        isQualified: input.isQualified,
      }),
    `Added "${input.label.trim()}".`,
  );
}

/**
 * Save a stage's name and meaning together.
 *
 * One write rather than two, because they are edited together: saving a rename
 * and a meaning change separately would let the first succeed and the second be
 * refused, leaving the operator looking at a half-applied row.
 */
export async function updatePipelineStage(input: {
  objectKey: string;
  key: string;
  label?: string;
  isTerminal?: boolean;
  isWon?: boolean;
  isLost?: boolean;
  isQualified?: boolean;
}): Promise<SettingsWriteResult> {
  return editStages(
    input.objectKey,
    (stages) =>
      updateStage(stages, input.key, {
        label: input.label,
        isTerminal: input.isTerminal,
        isWon: input.isWon,
        isLost: input.isLost,
        isQualified: input.isQualified,
      }),
    "Stage saved.",
  );
}

export async function movePipelineStage(input: {
  objectKey: string;
  key: string;
  direction: "up" | "down";
}): Promise<SettingsWriteResult> {
  const direction = input.direction === "up" ? "up" : "down";
  return editStages(
    input.objectKey,
    (stages) => moveStage(stages, input.key, direction),
    "Order saved.",
  );
}

export type StageOccupancy = {
  count: number;
  /** Active stages this one's records could be moved to. */
  targets: { key: string; label: string }[];
};

/**
 * How many records sit in a stage, and where they could go instead.
 *
 * The panel calls this before offering to archive. `findStage` returns null by
 * design rather than guessing, so archiving an occupied stage would leave those
 * records rendering blank and missing from every filter — this is what turns
 * that into a question the operator answers.
 */
export async function getPipelineStageOccupancy(input: {
  objectKey: string;
  key: string;
}): Promise<{ ok: true; occupancy: StageOccupancy } | { ok: false; error: string }> {
  const scope = await operatorOrg();
  if ("error" in scope) return { ok: false, error: scope.error };
  if (!(await editablePipeline(scope.orgId, input.objectKey))) {
    return { ok: false, error: "Unknown pipeline." };
  }

  try {
    const [stages, count] = await Promise.all([
      listStageSet(scope.orgId, input.objectKey),
      countRecordsInStage(scope.orgId, input.objectKey, input.key),
    ]);
    const targets = stages
      .filter((s) => s.active && s.key !== input.key)
      .map((s) => ({ key: s.key, label: s.label }));
    return { ok: true, occupancy: { count, targets } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not check the stage." };
  }
}

/**
 * Archive a stage, moving any records out of it first.
 *
 * `moveToKey` is required when the stage is occupied. Refusing without one is
 * the guardrail: the alternative is a silent archive that strands every record
 * sitting there.
 */
export async function archivePipelineStage(input: {
  objectKey: string;
  key: string;
  moveToKey?: string;
}): Promise<SettingsWriteResult> {
  const scope = await operatorOrg();
  if ("error" in scope) return { ok: false, error: scope.error };
  if (!(await editablePipeline(scope.orgId, input.objectKey))) {
    return { ok: false, error: "Unknown pipeline." };
  }
  const objectKey: string = input.objectKey;

  let occupied: number;
  let current;
  try {
    [current, occupied] = await Promise.all([
      listStageSet(scope.orgId, objectKey),
      countRecordsInStage(scope.orgId, objectKey, input.key),
    ]);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not check the stage." };
  }

  const stage = findStage(current, input.key);
  if (!stage) return { ok: false, error: "That stage no longer exists." };

  // Validate the archive BEFORE moving anything. Moving records and then
  // discovering this was the last won stage would leave the pipeline intact and
  // the records relocated for no reason.
  const next = archiveStage(current, input.key);
  if (!next.ok) return { ok: false, error: next.error };

  let moved = 0;
  if (occupied > 0) {
    if (!input.moveToKey) {
      return {
        ok: false,
        error: `${occupied} record${occupied === 1 ? "" : "s"} still sit in "${stage.label}". Choose where to move them first.`,
      };
    }
    const result = await moveRecordsToStage(scope.orgId, objectKey, input.key, input.moveToKey);
    if (!result.ok) return { ok: false, error: result.error };
    moved = result.moved;
  }

  const saved = await saveStageSet(scope.orgId, objectKey, next.stages);
  if (!saved.ok) return { ok: false, error: saved.error };

  revalidateStageSurfaces();
  return {
    ok: true,
    persisted: true,
    message: moved
      ? `Archived "${stage.label}" and moved ${moved} record${moved === 1 ? "" : "s"}.`
      : `Archived "${stage.label}".`,
  };
}

export async function restorePipelineStage(input: {
  objectKey: string;
  key: string;
}): Promise<SettingsWriteResult> {
  return editStages(input.objectKey, (stages) => restoreStage(stages, input.key), "Stage restored.");
}
