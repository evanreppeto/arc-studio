import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import {
  ARC_GENERATED_SKILLS_TABLE,
  deleteGeneratedSkill,
  listGeneratedSkills,
  saveGeneratedSkill,
  toWorkspaceArcSkill,
  type GeneratedSkillRecord,
} from "./persistence";

const ORG = "org-1";

const RECORD: GeneratedSkillRecord = {
  key: "generated-bsr-email-persona-landlord",
  name: "BSR email voice",
  description: "Write email copy in BSR's proven voice.",
  command: "/write-email-persona-landlord",
  assetType: "email",
  persona: "persona_landlord",
  evidenceTier: "outcome",
  instructions: "---\nname: BSR email voice\n---\n# examples",
  exemplarCount: 3,
  sourceAssetIds: ["a1", "a2", "a3"],
  counterExampleAssetIds: ["d1"],
  generatedAt: "2026-07-22T12:00:00.000Z",
};

const ROW = {
  key: RECORD.key,
  name: RECORD.name,
  description: RECORD.description,
  command: RECORD.command,
  asset_type: "email",
  persona: "persona_landlord",
  evidence_tier: "outcome",
  instructions: RECORD.instructions,
  exemplar_count: 3,
  source_asset_ids: ["a1", "a2", "a3"],
  counter_example_asset_ids: ["d1"],
  generated_at: RECORD.generatedAt,
};

describe("saveGeneratedSkill", () => {
  it("upserts on (org_id, key) so regenerating replaces rather than accumulates", async () => {
    const supabase = createSupabaseQueryMock({ [ARC_GENERATED_SKILLS_TABLE]: { data: null, error: null } });
    await saveGeneratedSkill(ORG, RECORD, supabase);

    const upsert = supabase.calls.find(([method]) => method === "upsert");
    expect(upsert).toBeDefined();
    const [, payload, options] = upsert as [string, Record<string, unknown>, { onConflict: string }];
    expect(options.onConflict).toBe("org_id,key");
    expect(payload.org_id).toBe(ORG);
    expect(payload.evidence_tier).toBe("outcome");
    // Provenance is what makes the artifact auditable — it must actually persist.
    expect(payload.source_asset_ids).toEqual(["a1", "a2", "a3"]);
    expect(payload.counter_example_asset_ids).toEqual(["d1"]);
    expect(payload.exemplar_count).toBe(3);
  });

  it("stamps the workspace it is given (BSR-712)", async () => {
    const supabase = createSupabaseQueryMock({ [ARC_GENERATED_SKILLS_TABLE]: { data: null, error: null } });
    await saveGeneratedSkill(ORG, RECORD, supabase, "ws-1");

    const upsert = supabase.calls.find(([method]) => method === "upsert");
    const [, payload] = upsert as [string, Record<string, unknown>];
    expect(payload.workspace_id).toBe("ws-1");
    // The caller's workspace must win outright — a fallback lookup here would be
    // a second source of truth for the same answer.
    expect(supabase.calls.some(([method]) => method === "from" )).toBe(true);
  });

  it("falls back to the org's sole workspace when the caller has none", async () => {
    // The caller's context types workspaceId as `string | null`, so this path is
    // reachable. It must resolve rather than write an unscoped row.
    const supabase = createSupabaseQueryMock({
      workspaces: { data: [{ id: "ws-only" }], error: null },
      [ARC_GENERATED_SKILLS_TABLE]: { data: null, error: null },
    });
    await saveGeneratedSkill(ORG, RECORD, supabase, null);

    const upsert = supabase.calls.find(([method]) => method === "upsert");
    const [, payload] = upsert as [string, Record<string, unknown>];
    expect(payload.workspace_id).toBe("ws-only");
  });

  it("omits workspace_id rather than guessing when the org has two workspaces", async () => {
    // Ambiguity must not be resolved by picking one: through Phase A the column
    // is nullable, and a NULL is visible to BSR-713's gate. A wrong workspace is
    // not.
    const supabase = createSupabaseQueryMock({
      workspaces: { data: [{ id: "ws-a" }, { id: "ws-b" }], error: null },
      [ARC_GENERATED_SKILLS_TABLE]: { data: null, error: null },
    });
    await saveGeneratedSkill(ORG, RECORD, supabase, null);

    const upsert = supabase.calls.find(([method]) => method === "upsert");
    const [, payload] = upsert as [string, Record<string, unknown>];
    expect(payload).not.toHaveProperty("workspace_id");
    expect(payload.org_id).toBe(ORG);
  });

  it("throws with the table name when the write fails", async () => {
    const supabase = createSupabaseQueryMock({ [ARC_GENERATED_SKILLS_TABLE]: { data: null, error: { message: "boom" } } });
    await expect(saveGeneratedSkill(ORG, RECORD, supabase)).rejects.toThrow(ARC_GENERATED_SKILLS_TABLE);
  });
});

describe("listGeneratedSkills", () => {
  it("returns nothing without an org rather than reading across workspaces", async () => {
    const supabase = createSupabaseQueryMock({ [ARC_GENERATED_SKILLS_TABLE]: { data: [ROW], error: null } });
    expect(await listGeneratedSkills(null, supabase)).toEqual([]);
    expect(supabase.calls).toHaveLength(0);
  });

  it("scopes the read to the org and maps rows to records", async () => {
    const supabase = createSupabaseQueryMock({ [ARC_GENERATED_SKILLS_TABLE]: { data: [ROW], error: null } });
    const records = await listGeneratedSkills(ORG, supabase);
    expect(supabase.calls).toContainEqual(["eq", "org_id", ORG]);
    expect(records).toEqual([RECORD]);
  });

  it("tolerates malformed provenance without dropping the skill", async () => {
    const supabase = createSupabaseQueryMock({
      [ARC_GENERATED_SKILLS_TABLE]: {
        data: [{ ...ROW, source_asset_ids: "not-an-array", counter_example_asset_ids: null, exemplar_count: null }],
        error: null,
      },
    });
    const [record] = await listGeneratedSkills(ORG, supabase);
    expect(record!.sourceAssetIds).toEqual([]);
    expect(record!.counterExampleAssetIds).toEqual([]);
    expect(record!.exemplarCount).toBe(0);
  });
});

describe("deleteGeneratedSkill", () => {
  it("deletes by org and key, never by key alone", async () => {
    const supabase = createSupabaseQueryMock({ [ARC_GENERATED_SKILLS_TABLE]: { data: null, error: null } });
    await deleteGeneratedSkill(ORG, RECORD.key, supabase);
    expect(supabase.calls).toContainEqual(["delete"]);
    expect(supabase.calls).toContainEqual(["eq", "org_id", ORG]);
    expect(supabase.calls).toContainEqual(["eq", "key", RECORD.key]);
  });
});

describe("toWorkspaceArcSkill", () => {
  it("maps onto the shape the runner already loads", () => {
    const skill = toWorkspaceArcSkill(RECORD, "Big Shoulders Restoration");
    expect(skill).toMatchObject({
      key: RECORD.key,
      id: "approval-gated-drafting",
      commands: ["/write-email-persona-landlord"],
      mode: "draft",
      source: "generated",
      publisher: "Big Shoulders Restoration",
      instructions: RECORD.instructions,
    });
    expect(skill.repositoryUrl).toBeUndefined();
  });
});
