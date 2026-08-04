import { describe, expect, it } from "vitest";

import {
  applyEnrichmentToLead,
  deriveTierFromEnrichment,
  mapEnrichmentToCompanyFirmographics,
  type EnrichmentFields,
} from "../enrichment";
import { parseLeadIngestionPayload, type LeadIngestionInput } from "../lead-ingestion";
import { OFFICIAL_PERSONA_MAPPINGS } from "../personas";

const PERSONA = OFFICIAL_PERSONA_MAPPINGS[0];

describe("deriveTierFromEnrichment", () => {
  it("tiers by headcount", () => {
    expect(deriveTierFromEnrichment({ employeeCount: 500 })).toBe("A");
    expect(deriveTierFromEnrichment({ employeeCount: 40 })).toBe("B");
    expect(deriveTierFromEnrichment({ employeeCount: 3 })).toBe("C");
  });

  it("tiers by revenue when headcount is absent", () => {
    expect(deriveTierFromEnrichment({ annualRevenueUsd: 80_000_000 })).toBe("A");
    expect(deriveTierFromEnrichment({ annualRevenueUsd: 9_000_000 })).toBe("B");
    expect(deriveTierFromEnrichment({ annualRevenueUsd: 250_000 })).toBe("C");
  });

  it("takes the higher of the two signals", () => {
    // small headcount but enterprise revenue → A
    expect(deriveTierFromEnrichment({ employeeCount: 5, annualRevenueUsd: 60_000_000 })).toBe("A");
  });

  it("returns null when there is no size signal (leaves scoring untouched)", () => {
    expect(deriveTierFromEnrichment({ industry: "Roofing" })).toBeNull();
    expect(deriveTierFromEnrichment({ employeeCount: 0, annualRevenueUsd: 0 })).toBeNull();
  });
});

describe("mapEnrichmentToCompanyFirmographics", () => {
  it("normalizes present fields and drops empties", () => {
    const fields: EnrichmentFields = {
      domain: " acme.co ",
      employeeCount: 120,
      annualRevenueUsd: 12_000_000,
      industry: "Restoration",
      role: "Owner",
      seniority: "",
    };
    expect(mapEnrichmentToCompanyFirmographics(fields)).toEqual({
      domain: "acme.co",
      employee_count: 120,
      annual_revenue_usd: 12_000_000,
      industry: "Restoration",
      role: "Owner",
    });
  });

  it("returns null when nothing usable is supplied", () => {
    expect(mapEnrichmentToCompanyFirmographics({ employeeCount: 0 })).toBeNull();
  });
});

describe("applyEnrichmentToLead", () => {
  const baseLead: LeadIngestionInput = {
    persona: PERSONA,
    source: "hubspot",
    company: { name: "Acme" },
    contact: { email: "d@acme.co" },
  };

  it("stamps the derived tier and firmographics, staying contract-valid", () => {
    const enriched = applyEnrichmentToLead(baseLead, { employeeCount: 400, industry: "Restoration", domain: "acme.co" });
    expect(enriched.company).toMatchObject({ name: "Acme", partnerTier: "A" });
    expect(enriched.metadata).toMatchObject({ enrichment: { employee_count: 400, industry: "Restoration", domain: "acme.co" } });
    // Round-trips through the real validator — proves enrichment keeps it ingestible.
    const parsed = parseLeadIngestionPayload(enriched);
    expect(parsed.ok).toBe(true);
  });

  it("preserves an explicit partnerTier over a derived one", () => {
    const withTier: LeadIngestionInput = { ...baseLead, company: { name: "Acme", partnerTier: "C" } };
    const enriched = applyEnrichmentToLead(withTier, { employeeCount: 400 });
    expect(enriched.company).toMatchObject({ partnerTier: "C" });
  });

  it("does not mutate the input", () => {
    const input: LeadIngestionInput = { ...baseLead, company: { name: "Acme" } };
    applyEnrichmentToLead(input, { employeeCount: 400 });
    expect(input.company).toEqual({ name: "Acme" });
    expect(input.metadata).toBeUndefined();
  });

  it("creates a company block from the enrichment name when the lead has none", () => {
    const noCompany: LeadIngestionInput = { persona: PERSONA, source: "hubspot", contact: { email: "x@y.co" } };
    const enriched = applyEnrichmentToLead(noCompany, { companyName: "Discovered Co", employeeCount: 30 });
    expect(enriched.company).toMatchObject({ name: "Discovered Co", partnerTier: "B" });
  });

  it("leaves the lead unchanged when enrichment yields nothing", () => {
    const enriched = applyEnrichmentToLead(baseLead, { role: "" });
    expect(enriched.company).toEqual({ name: "Acme" });
    expect(enriched.metadata).toBeUndefined();
  });
});
