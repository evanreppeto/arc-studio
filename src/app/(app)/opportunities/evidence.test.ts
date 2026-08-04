import { describe, expect, it } from "vitest";

import { findIdentifierLeak } from "@/domain";

import {
  extraEvidenceRows,
  formatEvidenceValue,
  humanizeEvidenceKey,
  humanizeToolTrace,
  isToolTrace,
  looksLikeIdentifier,
} from "./evidence";

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

describe("looksLikeIdentifier", () => {
  it("catches the shapes that reached the live panel", () => {
    expect(looksLikeIdentifier("062c799e-6359-454d-a6a6-40f330b0f9f0")).toBe(true);
    expect(looksLikeIdentifier("a3f9c2e1b7d84f6a0c5e2b91")).toBe(true);
  });

  it("leaves real evidence alone", () => {
    // Every false positive here deletes proof from the one panel whose job is
    // proving a claim. These are all real values from the live inbox.
    for (const value of [
      "Cook, DuPage, Will — IL",
      "emergency-homeowner",
      "Suburban Home Background Asset",
      "Service Van — Driveway Morning",
      "moderate",
      "2026-07-31",
      "60613, 60614",
    ]) {
      expect(looksLikeIdentifier(value), value).toBe(false);
    }
  });
});

describe("tool traces", () => {
  it("recognises the trace the live panel rendered under 'Source'", () => {
    expect(isToolTrace("read_recent_activity + query_brain(campaign_ref) + list_opportunities")).toBe(true);
    expect(isToolTrace("mcp__arc__search_contacts")).toBe(true);
  });

  it("does not mistake ordinary evidence for a trace", () => {
    for (const value of ["Chicago Tribune", "moderate", "Cook, DuPage, Will — IL", "storm damage"]) {
      expect(isToolTrace(value), value).toBe(false);
    }
  });

  it("keeps the fact and drops the spelling", () => {
    expect(humanizeToolTrace("read_recent_activity + query_brain(campaign_ref) + list_opportunities")).toBe(
      "Read recent activity · Query brain · List opportunities",
    );
  });

  it("routes a trace through the formatter rather than printing it", () => {
    const out = formatEvidenceValue("read_recent_activity + query_brain(campaign_ref)");
    expect(out).toBe("Read recent activity · Query brain");
    expect(findIdentifierLeak(out!)).toBeNull();
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
    // Verbatim evidence from the 2026-08-03 prod scan (opportunity 7865e1f7) —
    // including the FULL uuids. This fixture previously abbreviated them to
    // "062c799e", which is why it asserted the identifiers rendered and nobody
    // noticed: the shortened form is not a uuid, so the case the panel actually
    // ships was never exercised (BSR-732).
    const rows = extraEvidenceRows({
      source: "read_recent_activity + query_brain(campaign_ref)",
      persona: "emergency-homeowner",
      advisory_area: "Cook, DuPage, Will — IL",
      active_flood_advisories: [
        "062c799e-6359-454d-a6a6-40f330b0f9f0",
        "dba405db-915e-4288-9abd-716c4e7e2b4b",
      ],
      mediaAvailable_approved: 0,
      serviceAreas_configured: [],
      draft_assets: [{ campaign: "Suburban Home Background Asset" }],
    });

    expect(rows).toEqual([
      { label: "Advisory area", value: "Cook, DuPage, Will — IL" },
      // The count survives; the primary keys do not.
      { label: "Active flood advisories", value: "2 items" },
      { label: "Media available approved", value: "0" },
      { label: "Service areas configured", value: "None" },
      { label: "Draft assets", value: "Suburban Home Background Asset" },
    ]);
  });

  it("never emits an identifier, whatever Arc put in the payload", () => {
    const rows = extraEvidenceRows({
      campaign_ref: "0bd41cb3-ff30-4548-92e6-4ba431b61c8d",
      digest: "a3f9c2e1b7d84f6a0c5e2b91",
      linked_records: [{ id: "02a05c97-5f0d-4ab7-8440-8d1c213fa847" }],
    });

    // A row whose only content was an id is dropped outright; a LIST of them
    // keeps its count, because "how many" is a fact and the ids are not.
    expect(rows).toEqual([{ label: "Linked records", value: "1 item" }]);
    for (const row of rows) expect(findIdentifierLeak(row.value)).toBeNull();
  });

  it("preserves the order Arc wrote the keys in", () => {
    const rows = extraEvidenceRows({ crm_jobs: 0, crm_outcomes: 0, inbox_coverage: "only persona of 4" });
    expect(rows.map((r) => r.label)).toEqual(["CRM jobs", "CRM outcomes", "Inbox coverage"]);
  });
});
