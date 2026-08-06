import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: vi.fn(() => true),
  getSupabaseAdminClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/demo/demo-mode", () => ({ isDemoDataEnabled: vi.fn(() => false) }));
vi.mock("@/lib/personas/console", () => ({ listPersonas: vi.fn(async () => []) }));
vi.mock("@/lib/campaigns/read-model", () => ({ listCampaignNames: vi.fn(async () => []) }));
vi.mock("@/lib/crm/read-model", () => ({ getCrmMentionSamples: vi.fn(async () => ({})) }));
vi.mock("@/lib/vault/persistence", () => ({ listVaultNotes: vi.fn(async () => []) }));
vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({ orgId: "org-1", workspaceId: "ws-1" })),
}));
vi.mock("@/lib/settings/store", () => ({ getAppSettings: vi.fn(async () => null) }));
vi.mock("@/lib/brand-kit/persistence", () => ({ getBusinessProfile: vi.fn(async () => null) }));

import { getCrmMentionSamples } from "@/lib/crm/read-model";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { listPersonas } from "@/lib/personas/console";
import { getAppSettings } from "@/lib/settings/store";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { getMentionables } from "./mention-search";

const demoMode = vi.mocked(isDemoDataEnabled);
const personas = vi.mocked(listPersonas);
const supabaseConfigured = vi.mocked(isSupabaseAdminConfigured);
const appSettings = vi.mocked(getAppSettings);
const crmSamples = vi.mocked(getCrmMentionSamples);

/** One sample row per CRM object, so every group survives the empty-group filter. */
function everyCrmObjectPopulated() {
  crmSamples.mockResolvedValue({
    leads: [{ id: "l1", name: "Lead" }],
    companies: [{ id: "co1", name: "Company" }],
    contacts: [{ id: "c1", name: "Contact" }],
    properties: [{ id: "p1", name: "Property" }],
    jobs: [{ id: "j1", name: "Job" }],
    outcomes: [{ id: "o1", name: "Outcome" }],
  } as unknown as Awaited<ReturnType<typeof getCrmMentionSamples>>);
}

function labelFor(groups: Awaited<ReturnType<typeof getMentionables>>, type: string) {
  return groups.find((g) => g.type === type)?.label;
}

function personaGroup(groups: Awaited<ReturnType<typeof getMentionables>>) {
  return groups.find((g) => g.type === "persona");
}

describe("getMentionables — persona group", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseConfigured.mockReturnValue(true);
    demoMode.mockReturnValue(false);
    personas.mockResolvedValue([]);
    appSettings.mockResolvedValue(null as unknown as Awaited<ReturnType<typeof getAppSettings>>);
    crmSamples.mockResolvedValue({} as unknown as Awaited<ReturnType<typeof getCrmMentionSamples>>);
  });

  it("offers the org's own personas", async () => {
    personas.mockResolvedValue([
      { slug: "emergency-repair", name: "Emergency repair" },
      { slug: "maintenance-member", name: "Maintenance member" },
    ] as unknown as Awaited<ReturnType<typeof listPersonas>>);

    const group = personaGroup(await getMentionables());

    expect(group?.items.map((i) => i.id)).toEqual(["emergency-repair", "maintenance-member"]);
  });

  // The regression this file exists for. `listPersonas` resolving to `[]` used to
  // fall through to BSR's 12 — but with Supabase configured that is a LIVE
  // workspace, so real tenants were offered restoration personas they don't have.
  it("offers NO personas when a live workspace has none", async () => {
    personas.mockResolvedValue([]);

    const groups = await getMentionables();

    expect(personaGroup(groups)).toBeUndefined();
  });

  // Same path, and the more dangerous one: the caller's `.catch(() => [])` makes a
  // failed persona read indistinguishable from an empty one.
  it("offers NO personas when the live persona read fails", async () => {
    personas.mockRejectedValue(new Error("boom"));

    const groups = await getMentionables();

    expect(personaGroup(groups)).toBeUndefined();
  });

  it("offers NO personas offline unless demo data is on", async () => {
    supabaseConfigured.mockReturnValue(false);

    expect(await getMentionables()).toEqual([]);
  });

  it("offers the BSR demo set offline in demo mode, with acronyms cased correctly", async () => {
    supabaseConfigured.mockReturnValue(false);
    demoMode.mockReturnValue(true);

    const group = personaGroup(await getMentionables());

    expect(group?.items).toHaveLength(12);
    // humanizePersonaLabel, not the hand-rolled title-caser that produced "Hoa Board".
    expect(group?.items.find((i) => i.id === "persona_hoa_board")?.label).toBe("HOA board");
  });

  it("offers the BSR demo set in demo mode when a workspace has no personas", async () => {
    demoMode.mockReturnValue(true);
    personas.mockResolvedValue([]);

    expect(personaGroup(await getMentionables())?.items).toHaveLength(12);
  });
});

describe("getMentionables — CRM group labels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseConfigured.mockReturnValue(true);
    demoMode.mockReturnValue(false);
    personas.mockResolvedValue([]);
    appSettings.mockResolvedValue(null as unknown as Awaited<ReturnType<typeof getAppSettings>>);
    everyCrmObjectPopulated();
  });

  function withIndustry(industry: string) {
    appSettings.mockResolvedValue({ industry } as unknown as Awaited<ReturnType<typeof getAppSettings>>);
  }

  // The regression: these labels were hardcoded to restoration's nouns, so every
  // workspace saw "Properties" and "Jobs" regardless of its configured vocabulary.
  it("names groups in the workspace's own vocabulary", async () => {
    withIndustry("home_services");

    const groups = await getMentionables();

    expect(labelFor(groups, "property")).toBe("Service locations");
    expect(labelFor(groups, "contact")).toBe("Customers");
    expect(labelFor(groups, "lead")).toBe("Requests");
  });

  it("uses a different vocabulary for a different industry", async () => {
    withIndustry("professional_services");

    const groups = await getMentionables();

    expect(labelFor(groups, "job")).toBe("Engagements");
    expect(labelFor(groups, "contact")).toBe("Clients");
    expect(labelFor(groups, "lead")).toBe("Inquiries");
  });

  // No industry set must land on `general`'s neutral nouns, NOT on restoration's
  // — that silent fallback is what this change removes.
  it("falls back to neutral nouns when no industry is set", async () => {
    const groups = await getMentionables();

    expect(labelFor(groups, "property")).toBe("Sites");
    expect(labelFor(groups, "contact")).toBe("People");
    expect(labelFor(groups, "job")).toBe("Projects");
  });

  it("still says Properties and Jobs for a restoration workspace", async () => {
    withIndustry("restoration");

    const groups = await getMentionables();

    expect(labelFor(groups, "property")).toBe("Properties");
    expect(labelFor(groups, "job")).toBe("Jobs");
  });
});
