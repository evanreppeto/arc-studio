import { describe, expect, it } from "vitest";

import { extraEvidenceRows, formatEvidenceValue, humanizeEvidenceKey } from "./evidence";

describe("humanizeEvidenceKey", () => {
  it("handles the three casings Arc mixes", () => {
    expect(humanizeEvidenceKey("advisory_area")).toBe("Advisory area");
    expect(humanizeEvidenceKey("mediaAvailable_approved")).toBe("Media available approved");
    expect(humanizeEvidenceKey("inbox-coverage")).toBe("Inbox coverage");
  });

  it("shouts acronyms instead of title-casing them", () => {
    expect(humanizeEvidenceKey("crm_jobs")).toBe("CRM jobs");
    expect(humanizeEvidenceKey("crm_all_tables_empty")).toBe("CRM all tables empty");
  });

  it("returns empty for a key with no word characters", () => {
    expect(humanizeEvidenceKey("__")).toBe("");
  });
});

describe("formatEvidenceValue", () => {
  it("renders scalars", () => {
    expect(formatEvidenceValue("Cook, DuPage, Will — IL")).toBe("Cook, DuPage, Will — IL");
    expect(formatEvidenceValue(0)).toBe("0");
    expect(formatEvidenceValue(true)).toBe("Yes");
    expect(formatEvidenceValue(false)).toBe("No");
  });

  it("skips nothing-values but keeps a meaningful zero", () => {
    expect(formatEvidenceValue(null)).toBeNull();
    expect(formatEvidenceValue(undefined)).toBeNull();
    expect(formatEvidenceValue("   ")).toBeNull();
    // 0 contacts IS the finding — it must not be dropped as falsy.
    expect(formatEvidenceValue(0)).toBe("0");
  });

  it("reports an empty array as None, because the absence is the finding", () => {
    expect(formatEvidenceValue([])).toBe("None");
  });

  it("names array entries and collapses a long tail", () => {
    expect(formatEvidenceValue(["a", "b"])).toBe("a, b");
    expect(formatEvidenceValue(["a", "b", "c", "d", "e", "f"])).toBe("a, b, c, d +2 more");
  });

  it("pulls a label out of object entries", () => {
    const draftAssets = [
      { id: "0bd41cb3", status: "draft", campaign: "Suburban Home Background Asset" },
      { id: "02a05c97", status: "draft", campaign: "Service Van — Driveway Morning" },
    ];
    expect(formatEvidenceValue(draftAssets)).toBe("Suburban Home Background Asset, Service Van — Driveway Morning");
  });

  it("falls back to a count when array entries carry no label", () => {
    expect(formatEvidenceValue([{ lat: 1, lng: 2 }])).toBe("1 item");
    expect(formatEvidenceValue([{ lat: 1 }, { lat: 2 }])).toBe("2 items");
  });

  it("truncates a value too long to scan", () => {
    const long = "x".repeat(200);
    const out = formatEvidenceValue(long);
    expect(out).toHaveLength(160);
    expect(out?.endsWith("…")).toBe(true);
  });
});

describe("extraEvidenceRows", () => {
  it("skips keys the bespoke rows already render", () => {
    const rows = extraEvidenceRows({ persona: "emergency-homeowner", area: "Cook", severity: "moderate" });
    expect(rows).toEqual([]);
  });

  it("withholds the ready-to-send prompt payload", () => {
    expect(extraEvidenceRows({ arcPrompt: "Draft a follow-up for…" })).toEqual([]);
  });

  it("surfaces the generative scan's own keys, which used to be dropped", () => {
    // Verbatim evidence from the 2026-08-03 prod scan (opportunity 7865e1f7).
    const rows = extraEvidenceRows({
      source: "read_recent_activity + query_brain(campaign_ref)",
      persona: "emergency-homeowner",
      advisory_area: "Cook, DuPage, Will — IL",
      active_flood_advisories: ["062c799e", "dba405db"],
      mediaAvailable_approved: 0,
      serviceAreas_configured: [],
      draft_assets: [{ campaign: "Suburban Home Background Asset" }],
    });

    expect(rows).toEqual([
      { label: "Advisory area", value: "Cook, DuPage, Will — IL" },
      { label: "Active flood advisories", value: "062c799e, dba405db" },
      { label: "Media available approved", value: "0" },
      { label: "Service areas configured", value: "None" },
      { label: "Draft assets", value: "Suburban Home Background Asset" },
    ]);
  });

  it("preserves the order Arc wrote the keys in", () => {
    const rows = extraEvidenceRows({ crm_jobs: 0, crm_outcomes: 0, inbox_coverage: "only persona of 4" });
    expect(rows.map((r) => r.label)).toEqual(["CRM jobs", "CRM outcomes", "Inbox coverage"]);
  });
});
