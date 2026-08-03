import { describe, expect, it, vi } from "vitest";

const listFieldDefinitions = vi.fn();
const createFieldDefinition = vi.fn();
const saveCustomFieldValues = vi.fn();

vi.mock("@/lib/custom-fields/definitions", () => ({
  listFieldDefinitions: (...a: unknown[]) => listFieldDefinitions(...a),
  createFieldDefinition: (...a: unknown[]) => createFieldDefinition(...a),
}));
vi.mock("@/lib/custom-fields/values", () => ({
  saveCustomFieldValues: (...a: unknown[]) => saveCustomFieldValues(...a),
}));

import { provisionCustomFields, writeImportedCustomValues } from "./custom-fields";

const FIELD = { header: "Policy Number", key: "policy_number", label: "Policy Number", fieldType: "text" as const };

describe("provisionCustomFields", () => {
  it("reuses a definition that already exists rather than creating a near-duplicate", async () => {
    // The requirement that makes re-import safe. Creating "Policy number" beside
    // "Policy number" would strand the first import's values on a field the
    // operator thinks they already have.
    listFieldDefinitions.mockResolvedValue([{ key: "policy_number" }]);
    createFieldDefinition.mockClear();

    const out = await provisionCustomFields("org-1", [FIELD]);

    expect(out).toMatchObject({ created: [], reused: ["policy_number"] });
    expect(createFieldDefinition).not.toHaveBeenCalled();
  });

  it("creates a definition on leads when there isn't one", async () => {
    listFieldDefinitions.mockResolvedValue([]);
    createFieldDefinition.mockResolvedValue({ ok: true });

    const out = await provisionCustomFields("org-1", [FIELD]);

    expect(out.created).toEqual(["policy_number"]);
    expect(createFieldDefinition).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ objectKey: "leads", key: "policy_number", fieldType: "text" }),
      expect.anything(),
    );
  });

  it("treats an archived field as a reuse, not a failure", async () => {
    // createFieldDefinition reports "already exists" for an archived definition.
    // The operator archived it once; re-importing should not be blocked by their
    // own tidy-up.
    listFieldDefinitions.mockResolvedValue([]);
    createFieldDefinition.mockResolvedValue({ ok: false, error: 'A field named "Policy Number" already exists on this record type.' });

    const out = await provisionCustomFields("org-1", [FIELD]);

    expect(out.reused).toEqual(["policy_number"]);
    expect(out.failed).toEqual([]);
  });

  it("reports a genuine failure so the caller can drop the column before importing", async () => {
    listFieldDefinitions.mockResolvedValue([]);
    createFieldDefinition.mockResolvedValue({ ok: false, error: "Choices are required for a select field." });

    const out = await provisionCustomFields("org-1", [FIELD]);

    expect(out.created).toEqual([]);
    expect(out.failed).toEqual([{ key: "policy_number", error: "Choices are required for a select field." }]);
  });
});

describe("writeImportedCustomValues", () => {
  it("maps the file's header onto the field key", async () => {
    saveCustomFieldValues.mockClear().mockResolvedValue({ ok: true, saved: 1 });

    await writeImportedCustomValues("org-1", "lead-1", [FIELD], { "Policy Number": "POL-1" });

    expect(saveCustomFieldValues).toHaveBeenCalledWith(
      "org-1", "leads", "lead-1", { policy_number: "POL-1" }, expect.anything(),
    );
  });

  it("writes nothing when the row has no value for any kept column", async () => {
    saveCustomFieldValues.mockClear();
    await writeImportedCustomValues("org-1", "lead-1", [FIELD], { "Some Other Column": "x" });
    expect(saveCustomFieldValues).not.toHaveBeenCalled();
  });

  it("never lets a value failure fail the lead that already imported", async () => {
    saveCustomFieldValues.mockClear().mockRejectedValue(new Error("coercion exploded"));
    await expect(
      writeImportedCustomValues("org-1", "lead-1", [FIELD], { "Policy Number": "POL-1" }),
    ).resolves.toBeUndefined();
  });
});
